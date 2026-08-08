-- =====================================================================
-- BluePLM Core Schema
-- =====================================================================
-- 
-- This file contains the foundational schema required by ALL BluePLM installations:
--   - Organizations
--   - Users
--   - Teams & Permissions
--   - Authentication
--   - Sessions
--   - Notifications (generic)
--   - User Preferences
--
-- DEPENDENCIES: None (this is the base layer)
--
-- IDEMPOTENT: Safe to run multiple times
--
-- After running this, install optional modules from the modules/ folder:
--   - 10-source-files.sql (files, vaults, workflows)
--   - 20-change-control.sql (ECOs, reviews, deviations)
--   - 30-supply-chain.sql (suppliers, RFQs)
--   - 40-integrations.sql (Odoo, webhooks)
--   - 60-customers.sql (Odoo customer sync, AI enrichment)
--
-- =====================================================================

-- NO EXTENSIONS ARE INSTALLED HERE, DELIBERATELY
--
-- This file used to open with
--
--   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
--
-- with no SCHEMA clause, so the extension landed in whatever schema came first
-- in the caller's search_path - `public` for the postgres role. On Supabase
-- that was usually a no-op, because the platform preinstalls uuid-ossp in the
-- `extensions` schema. Where it was not preinstalled, the statement created a
-- dozen functions in public that the project can never withdraw from anon:
-- supautils runs CREATE EXTENSION for privileged extensions as supabase_admin,
-- so the functions come out owned by supabase_admin with `anon=X/supabase_admin`
-- in their ACL, and `postgres` revoking them gets "WARNING: no privileges could
-- be revoked" and no change. check_anon_reach() then reports objects reachable
-- without authentication that nobody can make unreachable. One CREATE EXTENSION
-- with no SCHEMA clause was enough to put a project permanently one step short
-- of a stamp.
--
-- Pinning it to `SCHEMA extensions` would only move the problem: that schema
-- does not exist outside Supabase, and every column default calling the
-- extension's uuid_generate_v4() would then depend on the caller's search_path
-- reaching it at CREATE TABLE time.
--
-- The dependency is not needed at all. gen_random_uuid() has been in core
-- Postgres since 13, generates the same v4 UUIDs from the server's strong
-- random source, and belongs to pg_catalog, which is on every search_path and
-- owned by a role no project can be asked to fight with. Every DEFAULT in this
-- release uses it, and migrate_uuid_defaults() at the end of this file moves
-- existing databases over so they stop depending on the extension too.
--
-- If an installation needs uuid-ossp for something else, install it yourself,
-- in the `extensions` schema, and check_anon_reach() will grade whatever it
-- creates in public as advisory rather than pretending it can be fixed.

-- ===========================================
-- SCHEMA VERSION TRACKING
-- ===========================================
-- schema_version.version is what the app reads to decide whether to show a
-- "database out of date" warning. It is therefore a claim about the whole
-- database, and the only useful property it can have is that it is never
-- higher than the truth.
--
-- It used to be written in three places that could each lie:
--
--   1. core.sql stamped the head unconditionally with ON CONFLICT DO UPDATE.
--      Re-running core.sql alone on an old database moved the number to the
--      head while every module stayed where it was.
--   2. Each module stamped the head as well, so that re-running one module -
--      the usual way a single RPC fix is applied - advanced the version.
--      Applying only 30-supply-chain.sql to a v86 database therefore reported
--      88 with module 10's v87 work absent, and the app showed no warning.
--   3. Under the documented `psql \i` path a module that errors partway
--      through still reaches its stamp at the end of the file.
--
-- The common cause is that the number is global and monotonic while the files
-- are per-module: no single number can express "30 applied, 10 not", so any
-- scheme where one file sets it is guessing about the others.
--
-- So nothing sets the version as a side effect of being run any more. The
-- version is a *result*, written only by verify_and_stamp_schema(), which
-- checks that the objects this release requires actually exist first. Modules
-- stamp nothing; core.sql seeds the row and never touches an existing one.
-- Applying a subset of the files leaves the old number in place, which is a
-- warning rather than a false all-clear. See supabase/README.md.

CREATE TABLE IF NOT EXISTS schema_version (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- Only allow single row
  version INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  applied_by TEXT
);

-- Seed only. DO NOTHING rather than DO UPDATE: on an existing database the
-- recorded version belongs to whatever was last verified, and core.sql knows
-- nothing about the modules, so it is in no position to overwrite it.
-- Version 0 on a fresh install reads as "installed but not yet verified".
INSERT INTO schema_version (id, version, description, applied_at, applied_by)
VALUES (1, 0, 'Installed but not verified - run supabase/tools/verify-schema.sql', NOW(), 'core.sql')
ON CONFLICT (id) DO NOTHING;

-- ===========================================
-- RELEASE MANIFEST
-- ===========================================
-- The single place the release number lives, and the single place that says
-- what a database must contain to be allowed to claim it.

CREATE OR REPLACE FUNCTION schema_release_version() RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$ SELECT 96 $$;

CREATE OR REPLACE FUNCTION schema_release_description() RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT
  'Every schema file asks try_stamp_schema() after installation, so the last file records '
  'the verified release automatically while partial installs remain unstamped'
$$;

-- One row per object this release requires, scoped to the module that creates it.
--
--   module  - label used in reports
--   probe   - a table whose presence means the module is installed, for OPTIONAL
--             modules only. A module that is not installed is skipped rather
--             than failed, so an optional module stays optional.
--
--             NULL for core and for the two modules the README calls required,
--             10-source-files and 15-inspection. Giving a required module a
--             probe made it self-excusing: the probe table is created by the
--             very file whose absence is the problem, so not installing the
--             module made every requirement of that module 'skipped' rather
--             than 'missing'. A database holding core.sql alone - 18 of 76
--             tables - passed every check and was stamped 89. A required module
--             must be able to fail, which means its requirements must be probed
--             unconditionally.
--   kind    - 'table' or 'function'
--   identity- table name, or function signature as regprocedure accepts it
--   requires- substring that must appear in the function source, or several
--             separated by ' && ', all of which must appear; NULL to only check
--             existence. This is what lets the manifest catch a body change (an
--             authorization check that went missing) and not just a missing
--             object. Matched against the source with comments and string
--             literals removed, so a token that only ever appears inside a
--             quoted string - anything a function builds for EXECUTE - will
--             never be found; name something the function actually calls.
CREATE OR REPLACE FUNCTION schema_release_manifest()
RETURNS TABLE (module TEXT, probe TEXT, kind TEXT, identity TEXT, requires TEXT)
LANGUAGE sql IMMUTABLE AS $$
  SELECT * FROM (VALUES
    -- core.sql
    ('core', NULL, 'function', 'require_org_member(uuid)', NULL),
    ('core', NULL, 'function', 'is_org_member(uuid)', NULL),
    ('core', NULL, 'function', 'schema_release_version()', NULL),
    ('core', NULL, 'function', 'try_stamp_schema()', NULL),
    -- The checks themselves are release content. A database carrying v90's
    -- copy of check_anon_reach() would look at no views at all and report a
    -- clean schema over the parts_with_pricing leak, so the manifest pins the
    -- shape of each: `severity` only exists in the version that distinguishes
    -- blocking from advisory, and `relkind` only in the one that reaches views.
    -- `anon_revoke_grantors` only exists in the version that decides blocking
    -- against advisory by asking who granted the privilege rather than treating
    -- every row as fatal, and that version is also the one that looks at
    -- procedures and at materialized views.
    -- `has_any_column_privilege` only exists in the version that sees a grant
    -- made on a single column: has_table_privilege(...,'SELECT') is false for
    -- one, so a view with `GRANT SELECT (part_number)` to anon was read over
    -- HTTP while this reported the schema clean.
    ('core', NULL, 'function', 'check_anon_reach()',
      'anon_revoke_grantors && has_any_column_privilege && anon_admitting_policies'),
    -- The sweep has to cover exactly what the check reports, or the check can
    -- report something the sweep cannot clear. anon_revoke_grantors is the call
    -- that makes the two agree; the version without it is the version where a
    -- procedure in public withheld the stamp for ever. It is named rather than
    -- the `ON ROUTINE` statement itself because `requires` is matched against
    -- the source with string literals removed, and every REVOKE in that
    -- function is built inside a format() literal.
    -- The same widening on the remedy side. A check that reports a column grant
    -- while the sweep cannot see it is the v90 defect again: a blocking
    -- condition the operator has no way to clear.
    ('core', NULL, 'function', 'enforce_anon_execute_posture()',
      'anon_revoke_grantors && has_any_column_privilege'),
    ('core', NULL, 'function', 'anon_revoke_grantors(oid)', NULL),
    ('core', NULL, 'function', 'anon_read_grantors(oid)', NULL),
    -- Which policies let anon see a row. Enabling row-level security is not the
    -- same act as excluding anon, and until this existed the check confused the
    -- two: `relrowsecurity = true` was taken as safe, so a table carrying
    -- `CREATE POLICY ... TO anon USING (true)` was read over HTTP.
    ('core', NULL, 'function', 'anon_admitting_policies(oid)', NULL),
    ('core', NULL, 'function', 'anon_read_allowlist()', NULL),
    ('core', NULL, 'function', 'probe_literal_for(text)', NULL),
    -- The probe takes its text literals from the function's own source where
    -- the source constrains them, so an argument validation stops being a free
    -- way to refuse the probe without ever running the authorization check.
    ('core', NULL, 'function', 'probe_literal_for_arg(oid,text,text)', NULL),
    -- strip_sql_noise, not a phrase from the pattern it looks for: `requires`
    -- is tested against the source with literals removed, and every mention of
    -- the pattern inside this function is inside a literal.
    ('core', NULL, 'function', 'check_null_unsafe_org_gates()', 'strip_sql_noise'),
    -- `row_selecting_id_args` is the widened rule: the previous version only
    -- looked at functions taking a p_org_id, so a function that gates on an
    -- entity instead was invisible to it - which is how
    -- apply_workflow_transition kept a foreign transition id.
    ('core', NULL, 'function', 'check_unbound_entity_args()', 'row_selecting_id_args'),
    ('core', NULL, 'function', 'row_selecting_id_args(oid)', NULL),
    -- `probe_literal_for` is the version that fills the non-org arguments with
    -- values a function can actually get past, instead of NULLs it refuses for
    -- reasons that have nothing to do with the organization.
    --
    -- `c_gate_binding` is the name the evidence pattern took when it stopped
    -- accepting auth.uid(). A function whose only recognised token was
    -- `v_actor UUID := auth.uid();` - a stamp of who asked, with no
    -- authorization anywhere - scored gated, was stamped, and served another
    -- tenant's parts over HTTP.
    -- `org_gate_exclusion_reason` is the version in which the exclusion list
    -- stopped being a list. A build carrying the previous copy skips three
    -- functions by name whatever their ACL says, which is how a
    -- SECURITY DEFINER function that authenticated could call was certified as
    -- gated; `unverifiable` is the version in which a reachable function the
    -- probe could not judge withholds the stamp instead of being reported and
    -- then ignored.
    -- `v_reachable` and not the word 'unverifiable': the latter appears in this
    -- function only inside a string literal, and `requires` is matched against
    -- the source with literals removed, so pinning on it would search for
    -- something that is never there and withhold the stamp for ever. That is
    -- the mistake this manifest has now had to be protected from four times.
    -- v_reachable is the variable the new verdict is decided by.
    ('core', NULL, 'function', 'check_org_gates()',
      'probe_literal_for_arg && c_gate_binding && org_gate_exclusion_reason && v_reachable'),
    -- Its own entry, not merely a token in the row above: `requires` is a
    -- substring search of the caller, so pinning check_org_gates() on the name
    -- proves only that it still calls something so called. This is the object
    -- that decides which functions are exempt from the org-gate probe, and a
    -- weakened copy - one that answered 'withdrawn' without consulting the ACL -
    -- would exempt everything while every row above it still read ok. Pinned on
    -- has_function_privilege, which is the term that makes the answer a fact
    -- about the database rather than a name on a list.
    ('core', NULL, 'function', 'org_gate_exclusion_reason(oid)',
      'has_function_privilege'),
    -- requires NULL on purpose. Everything this function contains is a string
    -- literal, and literals are stripped before `requires` is searched, so
    -- there is no token to pin that would not resolve to nothing. Its behaviour
    -- is covered where behaviour can be covered: NC18 in the harness grants
    -- seed_customer_categories back to authenticated and requires the stamp to
    -- be withheld, which is false unless this answers true for the verdict that
    -- produces.
    ('core', NULL, 'function', 'org_gate_status_blocks(text)', NULL),
    -- The pair that asserts an ACL rather than a refusal, for functions taking
    -- no organization argument.
    --
    -- requires NULL on the list, for the same reason org_gate_status_blocks()
    -- carries NULL: every name in it is a string literal, and `requires` is
    -- matched against the source with literals removed. Pinning it on
    -- 'cleanup_extension_http_logs' - which is the token a reader reaches for
    -- first, and which this row held until it was tested - searches for
    -- something that is never there and withholds the stamp for ever. That is
    -- the fifth time this file has had to be protected from that mistake.
    -- What the list contains is covered by NC19, which regrants EXECUTE on one
    -- of the two sweeps and requires the stamp to be withheld; a copy of the
    -- list that had dropped the entry cannot pass that.
    ('core', NULL, 'function', 'withdrawn_execute_manifest()', NULL),
    ('core', NULL, 'function', 'check_withdrawn_execute()',
      'has_function_privilege && withdrawn_execute_manifest'),
    ('core', NULL, 'function', 'migrate_uuid_defaults()', NULL),
    ('core', NULL, 'function', 'like_escape(text)', NULL),
    -- Closing a hole and revoking what the hole produced.
    ('core', NULL, 'table', 'schema_remediation_log', NULL),
    ('core', NULL, 'function', 'record_remediation(text,integer,jsonb,text)', NULL),
    ('core', NULL, 'function', 'check_release_residue()', NULL),
    -- The two org-scoped RPCs core.sql owns that used to hand-write the
    -- membership test out of auth.uid().
    ('core', NULL, 'function', 'get_org_module_defaults(uuid)', 'require_org_member'),
    ('core', NULL, 'function', 'get_org_column_defaults(uuid)', 'require_org_member'),
    ('core', NULL, 'function', 'set_org_module_defaults(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)', 'is_org_member'),
    ('core', NULL, 'function', 'force_org_module_defaults(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)', 'is_org_member'),
    ('core', NULL, 'function', 'set_org_column_defaults(uuid,jsonb)', 'is_org_member'),
    ('core', NULL, 'function', 'force_org_column_defaults(uuid,jsonb)', 'is_org_member'),
    ('core', NULL, 'function', 'update_org_branding(uuid,text,text,text,text,text)', 'is_org_member'),
    -- THE HELPERS THE ROWS ABOVE ARE PINNED ON
    --
    -- `requires` is a substring search of the *caller's* body, so it proves the
    -- caller still names the helper and says nothing whatever about what the
    -- helper does. Eleven rows across this manifest were pinned on six gate
    -- helpers that were not themselves entries, which means a weakened helper
    -- left all eleven reading 'ok' - the manifest reporting a schema verified
    -- against an authorization check that no longer authorized anything. The
    -- sharpest case is repair_config_maps, pinned on require_org_member &&
    -- is_org_admin with a comment reasoning that both matter, where only the
    -- first was an entry.
    --
    -- Each helper is pinned on the term that makes it a *membership* test
    -- rather than merely a lookup, so a body that resolved the entity and
    -- forgot to compare it to the caller's organization is stale, not ok.
    -- current_actor_id() is the other half: it is what refuses an
    -- unauthenticated caller before the comparison is reached.
    --
    -- require_auth is deliberately absent from this set. It appears in
    -- share_link_admission's `requires` below and reads like a seventh helper,
    -- but there is no such function - it is the file_share_links.require_auth
    -- column, and that row pins that the admission test still honours it. An
    -- entry for require_auth(...) would resolve to nothing and withhold the
    -- stamp for ever, which is the one failure mode this file has now had to be
    -- protected from three times.
    ('core', NULL, 'function', 'is_org_admin()',
      'u.org_id = v_user_org_id && t.org_id = v_user_org_id'),
    ('core', NULL, 'function', 'is_org_admin(uuid)',
      'u.org_id = v_user_org_id && t.org_id = v_user_org_id'),
    ('core', NULL, 'function', 'require_same_org_user(uuid)',
      'current_actor_id && actor.org_id = target.org_id'),
    -- One row per identity: check_schema_release() also reports unknown
    -- overloads while walking the manifest, and a second row for the same
    -- function would report each of those twice. The probe names the newest of
    -- the checks this function has to call, which cannot be present in a build
    -- that predates the others.
    ('core', NULL, 'function', 'verify_and_stamp_schema()',
      'check_unbound_entity_args && check_release_residue && org_gate_status_blocks && check_withdrawn_execute'),

    -- 10-source-files.sql - REQUIRED, so probe is NULL
    ('10-source-files', NULL, 'table', 'files', NULL),
    -- The two entity gates the rows below are pinned on. See the note beside
    -- is_org_admin() above for why a helper named by a `requires` clause has to
    -- be an entry in its own right.
    ('10-source-files', NULL, 'function', 'require_file_access(uuid)',
      'current_actor_id && u.org_id = v_org_id'),
    ('10-source-files', NULL, 'function', 'require_vault_access(uuid)',
      'current_actor_id && u.org_id = v_org_id'),
    ('10-source-files', NULL, 'function', 'merge_custom_properties(jsonb,jsonb)', NULL),
    ('10-source-files', NULL, 'function', 'checkin_file(uuid,uuid,text,bigint,text,text,text,text,integer,jsonb,text,text,text)', 'merge_custom_properties'),
    -- Repairs what the pre-87 checkin_file erased, and can only add keys. Both
    -- gates are pinned because they are independent: require_org_member decides
    -- whether the caller is in the organization named, is_org_admin whether an
    -- ordinary member may perform an admin write. A version carrying only the
    -- first would let any member of the organization rewrite its metadata.
    ('10-source-files', NULL, 'function', 'repair_config_maps(uuid,jsonb)', 'require_org_member && is_org_admin'),
    ('10-source-files', NULL, 'function', 'get_vault_files_fast(uuid,uuid)', 'require_org_member'),
    ('10-source-files', NULL, 'function', 'get_vault_files_delta(uuid,uuid,timestamptz)', 'require_org_member'),
    ('10-source-files', NULL, 'function', 'get_next_serial_number(uuid)', 'require_org_member'),
    ('10-source-files', NULL, 'function', 'preview_next_serial_number(uuid)', 'require_org_member'),
    ('10-source-files', NULL, 'function', 'update_serialization_settings_safe(uuid,jsonb)', 'require_org_member'),
    ('10-source-files', NULL, 'function', 'get_item_definition_settings(uuid)', 'require_org_member'),
    ('10-source-files', NULL, 'function', 'update_item_definition_settings(uuid,jsonb)', 'require_org_member'),
    ('10-source-files', NULL, 'function', 'get_item_images(uuid)', 'require_org_member'),
    ('10-source-files', NULL, 'function', 'create_default_workflow(uuid,uuid)', 'require_org_member'),
    -- Resolves the organization from p_file_id. It used to gate on p_org_id and
    -- then insert p_file_id without ever comparing them, so a member of any
    -- organization could mint a working token for another tenant's file.
    ('10-source-files', NULL, 'function', 'create_file_share_link(uuid,uuid,uuid,integer,integer,boolean)', 'require_file_access'),
    -- Both must call share_link_admission() rather than restate the conditions.
    --
    -- Pinning 'require_auth && is_org_member' on each of them separately was an
    -- attempt to make two hand-written condition lists agree by requiring the
    -- same words in both, and it does not work: v92 satisfied it while consume
    -- spent a download on a file validate refused, because only one of the two
    -- tested that the file still exists and the other's file test sat inside
    -- its require_auth branch. Two lists that must agree should be one list.
    ('10-source-files', NULL, 'function', 'share_link_admission(text)',
      'require_auth && is_org_member && deleted_at'),
    ('10-source-files', NULL, 'function', 'validate_share_link(text)', 'share_link_admission'),
    ('10-source-files', NULL, 'function', 'consume_share_link(text)', 'share_link_admission'),
    -- What the holes above produced, on a database that ran an earlier release.
    ('10-source-files', NULL, 'function', 'remediate_cross_tenant_share_links()', 'record_remediation'),
    ('10-source-files', NULL, 'function', 'remediate_cross_tenant_workflow_history()', 'record_remediation'),
    -- Entity-scoped: these resolve the organization from the id they are given
    -- and gate on that. They took no p_org_id, so the old sweep never saw them.
    ('10-source-files', NULL, 'function', 'checkout_file(uuid,uuid,text,text,text)', 'require_file_access'),
    ('10-source-files', NULL, 'function', 'move_file(uuid,uuid,text,text)', 'require_file_access'),
    ('10-source-files', NULL, 'function', 'rename_folder_files(text,text,uuid,uuid)', 'require_vault_access && like_escape'),
    ('10-source-files', NULL, 'function', 'get_available_transitions(uuid,uuid)', 'require_file_access'),
    -- Two ids, two checks. require_file_access covers the file; the org_id
    -- comparison is what stops a transition belonging to another tenant's
    -- workflow being applied to it. Pinning only the first is what let the
    -- second go missing in a function this manifest already listed.
    ('10-source-files', NULL, 'function', 'apply_workflow_transition(uuid,uuid,uuid,text,jsonb)', 'require_file_access && wtpl.org_id = v_org_id'),
    ('10-source-files', NULL, 'function', 'execute_workflow_transition(uuid,uuid,text)', 'is_org_member && wtpl.org_id = v_file.org_id'),
    ('10-source-files', NULL, 'function', 'execute_transition_to_legacy_state(uuid,text,text)', 'require_file_access'),
    ('10-source-files', NULL, 'function', 'get_user_vault_access(uuid)', 'require_same_org_user'),
    -- Who may decide a gate, in one place instead of two. complete_gate_review
    -- enforced reviewer identity only for an assigned review, so any member
    -- could approve an unassigned gate through the sanctioned RPC while
    -- get_my_pending_reviews - which had the correct rule written out - decided
    -- what to offer them. Both are pinned on the shared helper, so a release
    -- that lets either drift back to its own copy is stale rather than ok.
    ('10-source-files', NULL, 'function', 'may_review_gate(uuid,uuid)',
      'workflow_gate_reviewers && user_has_permission'),
    ('10-source-files', NULL, 'function', 'complete_gate_review(uuid,review_status,text,jsonb)',
      'is_org_member && may_review_gate'),
    ('10-source-files', NULL, 'function', 'get_my_pending_reviews()', 'may_review_gate'),

    -- 15-inspection.sql - REQUIRED, so probe is NULL
    ('15-inspection', NULL, 'table', 'inspection_characteristics', NULL),
    ('15-inspection', NULL, 'table', 'inspection_characteristic_versions', NULL),

    -- 20-change-control.sql
    ('20-change-control', 'ecos', 'table', 'eco_gate_approvals', NULL),
    ('20-change-control', 'ecos', 'function', 'require_eco_access(uuid)',
      'current_actor_id && u.org_id = v_org_id'),
    ('20-change-control', 'ecos', 'function', 'instantiate_process_template(uuid,uuid)', 'require_eco_access'),
    ('20-change-control', 'ecos', 'function', 'check_gate_requirements(uuid,text)', 'require_eco_access'),

    -- 30-supply-chain.sql
    ('30-supply-chain', 'rfqs', 'table', 'rfq_number_counters', NULL),
    ('30-supply-chain', 'rfqs', 'function', 'generate_rfq_number(uuid)', 'require_org_member'),
    -- A view, so it has no RLS of its own. to_regclass resolves views as well
    -- as tables; whether it is security_invoker and whether anon can read it
    -- are check_anon_reach()'s business.
    ('30-supply-chain', 'rfqs', 'table', 'parts_with_pricing', NULL),

    -- 40-integrations.sql
    ('40-integrations', 'webhooks', 'table', 'integration_credentials', NULL),
    -- Trigger-only; its protection is its ACL, which verify-schema.sql checks.
    ('40-integrations', 'webhooks', 'function', 'apply_pending_license_assignments(uuid)', NULL),
    -- Both hand-wrote the membership test out of auth.uid(). Correct, and the
    -- reason check_org_gates() had to treat auth.uid() as evidence of a gate -
    -- which is what let a function with no authorization at all be certified.
    ('40-integrations', 'webhooks', 'function', 'get_google_drive_settings(uuid)', 'require_org_member'),
    ('40-integrations', 'webhooks', 'function', 'update_google_drive_settings(uuid,text,text,boolean,text)', 'require_org_member'),

    -- 50-extensions.sql
    ('50-extensions', 'org_installed_extensions', 'function', 'get_extension_config(uuid,text)', 'require_org_member'),
    ('50-extensions', 'org_installed_extensions', 'function', 'get_extension_stats(uuid,text)', 'require_org_member'),
    ('50-extensions', 'org_installed_extensions', 'function', 'update_extension_config(uuid,text,jsonb)', 'require_org_member'),

    -- 60-customers.sql
    ('60-customers', 'customers', 'function', 'seed_customer_categories(uuid)', NULL)
  ) AS m(module, probe, kind, identity, requires);
$$;

-- ===========================================
-- WHAT A CLOSED HOLE LEFT BEHIND
-- ===========================================
-- CLOSING A HOLE AND REVOKING WHAT IT PRODUCED
--
-- Every release up to 92 was verified against a fresh install, so nothing had
-- ever asked a release whether it cleans up after itself. It does not, and a
-- fresh install cannot show that: there is no history for the fix to fail to
-- undo. Applied over a database that had run v90 and been attacked, v92 left a
-- share link minted by a member of one organization for another organization's
-- file still answering is_valid: true to an unauthenticated caller, and
-- consume_share_link still spending downloads against it. It survives BECAUSE
-- of the fix - validate_share_link now resolves the organization from the file,
-- and the file genuinely is in that organization - and verification returned
-- stamped: true with all of it in place.
--
-- The general shape, which is worth naming because this will happen again: a
-- security fix changes what the code will do next time. It does not change what
-- the data records from what the code already did. A credential a hole minted
-- outlives the hole, and so does a disclosure the hole performed.
--
-- The place where the two should always travel together is here, in the release
-- manifest, which until now only described objects. It has a second half now:
--
--   schema_release_manifest()  what the code must BE
--   check_release_residue()    what the data must no longer CONTAIN
--
-- Both are read by verify_and_stamp_schema() and both withhold the stamp. So a
-- release that closes a hole and forgets the remediation cannot be recorded:
-- verification names the residue and refuses, on the databases that have it and
-- on no others. A fresh install has none and is unaffected.
--
-- The remediations themselves run from the module that owns the data, at the
-- end of the file, next to enforce_anon_execute_posture() - so applying the
-- schema performs them and there is no separate script to remember. They are
-- idempotent, they deactivate and redact rather than delete, and they copy
-- every row they touch into the ledger below verbatim first, so nothing an
-- auditor might want is destroyed by the act of cleaning up.
CREATE TABLE IF NOT EXISTS schema_remediation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remediation TEXT NOT NULL,
  release INTEGER NOT NULL,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ran_by TEXT NOT NULL DEFAULT CURRENT_USER,
  rows_acted_on INTEGER NOT NULL,
  -- The rows as they were, before anything was changed. This is the reason the
  -- remediations are allowed to redact: the original is still here, and it is
  -- here in the one place no tenant can read.
  subjects JSONB NOT NULL DEFAULT '[]'::jsonb,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_schema_remediation_log_ran_at
  ON schema_remediation_log (ran_at DESC);

-- RLS on with no policies at all, deliberately.
--
-- Every other table in this schema is scoped to an organization. This one is
-- not scopeable: a cross-tenant row names two organizations and belongs to
-- neither, so there is no tenant it could be shown to without disclosing the
-- other. RLS enabled and no policy means nothing reaches it over PostgREST
-- under any role, while the operator reads it from the SQL editor as postgres,
-- which holds BYPASSRLS. That is the correct audience for it.
ALTER TABLE schema_remediation_log ENABLE ROW LEVEL SECURITY;

-- Record that a remediation acted, and say out loud what it acted on.
--
-- Silence is the failure mode that matters here. A remediation that quietly
-- deactivates a share link leaves somebody's link broken with no explanation
-- and no way to find out which, so every call prints the subjects by name as it
-- runs and stores them for afterwards. Nothing is written when a remediation
-- found nothing to do, which is what keeps re-running a module from filling the
-- ledger with rows saying no.
CREATE OR REPLACE FUNCTION record_remediation(
  p_name TEXT,
  p_rows INTEGER,
  p_subjects JSONB,
  p_detail TEXT
) RETURNS INTEGER
LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(p_rows, 0) = 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO schema_remediation_log (remediation, release, rows_acted_on, subjects, detail)
  VALUES (p_name, schema_release_version(), p_rows, COALESCE(p_subjects, '[]'::jsonb), p_detail);

  RAISE WARNING E'REMEDIATION % acted on % row(s): %\n  The rows as they were are in schema_remediation_log. %',
    p_name, p_rows, COALESCE(p_subjects, '[]'::jsonb)::text, COALESCE(p_detail, '');

  RETURN p_rows;
END;
$$;

REVOKE ALL ON FUNCTION record_remediation(TEXT, INTEGER, JSONB, TEXT) FROM PUBLIC, anon, authenticated;

-- Quote a value so that LIKE treats it as text rather than as a pattern.
--
-- rename_folder_files() builds `LOWER(file_path) LIKE LOWER(prefix) || '/%'`.
-- A folder whose name contains % or _ therefore matched paths the caller never
-- named: a user with a folder called `100%` renamed it and rewrote the path of
-- an unrelated file of their own. It is confined to the caller's own
-- organization and vault by the gates around it, so it is a correctness bug
-- rather than a way out of the tenant - but a prefix that is user-supplied text
-- being fed to LIKE as a pattern is the general shape, and the general shape is
-- worth having one answer to.
--
-- Backslash first, or the escapes added afterwards get escaped in turn.
-- Callers must pair this with ESCAPE '\', which is also LIKE's default; naming
-- it is what keeps the pairing visible at the call site.
CREATE OR REPLACE FUNCTION like_escape(p_text TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_');
$$;

REVOKE ALL ON FUNCTION like_escape(TEXT) FROM PUBLIC, anon;

-- Return a function's source with comments and string literals removed, so that
-- a `requires` substring test is answered by code and not by prose.
--
-- The manifest's whole purpose is to notice that an authorization check went
-- missing, and `position('require_org_member' IN pg_get_functiondef(oid))`
-- cannot tell the call from a note about the call. Both of these passed:
--
--   -- this used to call require_org_member(p_org_id) and no longer does
--   RAISE NOTICE 'require_org_member';
--
-- A regex cannot do this reliably - a comment may contain an apostrophe and a
-- literal may contain a double dash - so this walks the string once, tracking
-- which of the four states it is in. Dollar-quoted sections are kept: the
-- function body itself arrives dollar-quoted from pg_get_functiondef, and
-- dropping it would leave nothing to test.
--
-- It closes the cheap half of the hole. A check inside `IF false THEN` is still
-- code and still passes; check_org_gates() below is what catches that, by
-- calling the function and seeing whether it actually refuses.
CREATE OR REPLACE FUNCTION strip_sql_noise(p_src TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_out TEXT := '';
  v_len INTEGER := length(p_src);
  i INTEGER := 1;
  c TEXT;
  c2 TEXT;
  v_state TEXT := 'normal';   -- normal | line | block | quote
  v_depth INTEGER := 0;       -- block comment nesting
BEGIN
  WHILE i <= v_len LOOP
    c := substr(p_src, i, 1);
    c2 := substr(p_src, i, 2);

    IF v_state = 'normal' THEN
      IF c2 = '--' THEN
        v_state := 'line'; i := i + 2; CONTINUE;
      ELSIF c2 = '/*' THEN
        v_state := 'block'; v_depth := 1; i := i + 2; CONTINUE;
      ELSIF c = '''' THEN
        v_state := 'quote'; i := i + 1; CONTINUE;
      ELSE
        v_out := v_out || c; i := i + 1; CONTINUE;
      END IF;

    ELSIF v_state = 'line' THEN
      IF c = E'\n' THEN
        v_state := 'normal'; v_out := v_out || c;
      END IF;
      i := i + 1; CONTINUE;

    ELSIF v_state = 'block' THEN
      IF c2 = '/*' THEN
        v_depth := v_depth + 1; i := i + 2; CONTINUE;
      ELSIF c2 = '*/' THEN
        v_depth := v_depth - 1; i := i + 2;
        IF v_depth = 0 THEN v_state := 'normal'; END IF;
        CONTINUE;
      END IF;
      i := i + 1; CONTINUE;

    ELSE -- quote
      IF c2 = '''''' THEN
        i := i + 2; CONTINUE;          -- '' is an escaped quote, still inside
      ELSIF c = '''' THEN
        v_state := 'normal'; i := i + 1; CONTINUE;
      END IF;
      i := i + 1; CONTINUE;
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;

-- Evaluate the manifest. One row per requirement, status 'ok', 'missing',
-- 'stale', 'extra' or 'skipped'. Read-only, so it is safe to run at any time.
CREATE OR REPLACE FUNCTION check_schema_release()
RETURNS TABLE (module TEXT, identity TEXT, status TEXT, detail TEXT)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  m RECORD;
  v_oid OID;
  v_src TEXT;
  v_missing TEXT;
  v_extra RECORD;
BEGIN
  FOR m IN SELECT * FROM schema_release_manifest() LOOP
    IF m.probe IS NOT NULL AND to_regclass('public.' || m.probe) IS NULL THEN
      module := m.module; identity := m.identity; status := 'skipped';
      detail := 'module not installed';
      RETURN NEXT;
      CONTINUE;
    END IF;

    module := m.module;
    identity := m.identity;

    IF m.kind = 'table' THEN
      IF to_regclass('public.' || m.identity) IS NULL THEN
        status := 'missing'; detail := 'table does not exist';
      ELSE
        status := 'ok'; detail := NULL;
      END IF;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- to_regprocedure returns NULL rather than raising for an unknown signature
    v_oid := to_regprocedure('public.' || m.identity);

    IF v_oid IS NULL THEN
      status := 'missing'; detail := 'function does not exist';
    ELSIF m.requires IS NOT NULL THEN
      v_src := strip_sql_noise(pg_get_functiondef(v_oid));

      -- ' && ' separates substrings that must ALL be present.
      --
      -- One requirement per function stopped being enough as soon as a function
      -- had two properties worth pinning. apply_workflow_transition gates its
      -- file with require_file_access and binds its transition with an org_id
      -- comparison; naming only the first is what let the second be absent from
      -- a function this manifest already listed and reported ok.
      SELECT string_agg(t, ' and ') INTO v_missing
      FROM unnest(string_to_array(m.requires, ' && ')) AS t
      WHERE position(t IN v_src) = 0;

      IF v_missing IS NOT NULL THEN
        status := 'stale';
        detail := 'function exists but does not reference ' || v_missing
               || ' - an older copy of this module is installed';
      ELSE
        status := 'ok'; detail := NULL;
      END IF;
    ELSE
      status := 'ok'; detail := NULL;
    END IF;

    RETURN NEXT;

    -- An overload the manifest does not know about is a finding in its own
    -- right. Modules drop a function by its exact signature before re-creating
    -- it, so a previous release's version with a different argument list is not
    -- dropped - it sits alongside the current one, ungated, and the manifest
    -- looking only at the signature it expects reports 'ok'. PostgREST picks an
    -- overload by the argument *names* in the request body, so a client can ask
    -- for the old one by name and get it.
    FOR v_extra IN
      SELECT p.oid::regprocedure::TEXT AS signature
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = split_part(m.identity, '(', 1)
        AND p.oid <> v_oid
        AND NOT EXISTS (
          SELECT 1 FROM schema_release_manifest() m2
          WHERE m2.kind = 'function'
            AND to_regprocedure('public.' || m2.identity) = p.oid
        )
      ORDER BY 1
    LOOP
      module := m.module;
      identity := v_extra.signature;
      status := 'extra';
      detail := 'an overload of ' || split_part(m.identity, '(', 1)
             || ' that this release does not define - almost certainly a previous '
             || 'release''s copy that DROP ... (exact signature) did not remove. '
             || 'Drop it: DROP FUNCTION public.' || v_extra.signature || ';';
      RETURN NEXT;
    END LOOP;
  END LOOP;
END;
$$;

-- A value of the given type that a function has some chance of accepting.
--
-- check_org_gates() passes one of these for every argument except the
-- organization id. It exists because the probe used to pass NULL for all of
-- them, which meant a function whose first act is `IF p_name IS NULL THEN RAISE`
-- was scored "gated" without its organization check ever executing. The point
-- of the probe is to reach the gate, and it cannot reach the gate through an
-- argument validation that fires first.
--
-- These are values, not fixtures: a random uuid selects no row, an empty jsonb
-- carries no keys. Every probe call is made inside a subtransaction that is
-- always rolled back, so a function that does accept them changes nothing.
-- Anything not listed falls back to NULL, which is the old behaviour and is
-- reported as inconclusive if the function then trips over it.
CREATE OR REPLACE FUNCTION probe_literal_for(p_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_base TEXT := lower(btrim(p_type));
BEGIN
  -- Arrays: the empty array is always well typed and always selects nothing.
  IF v_base LIKE '%[]' THEN
    RETURN format('%L::%s', '{}', v_base);
  END IF;

  RETURN CASE
    WHEN v_base IN ('uuid') THEN quote_literal(gen_random_uuid()::text) || '::uuid'
    WHEN v_base IN ('text', 'character varying', 'varchar', 'name', 'citext', 'char', 'character')
      THEN quote_literal('blueplm_gate_probe') || '::' || v_base
    WHEN v_base IN ('smallint', 'integer', 'bigint', 'int2', 'int4', 'int8',
                    'numeric', 'real', 'double precision', 'float4', 'float8')
      THEN '1::' || v_base
    WHEN v_base = 'boolean' THEN 'false'
    WHEN v_base IN ('json', 'jsonb') THEN quote_literal('{}') || '::' || v_base
    WHEN v_base IN ('date', 'timestamp without time zone', 'timestamp with time zone',
                    'timestamp', 'timestamptz')
      THEN 'now()::' || v_base
    WHEN v_base = 'interval' THEN quote_literal('0') || '::interval'
    -- Enums: any label is as good as another, and there is no safe generic
    -- guess, so take the first one the type declares.
    WHEN EXISTS (SELECT 1 FROM pg_type t WHERE t.oid = to_regtype(v_base) AND t.typtype = 'e')
      THEN quote_literal((SELECT e.enumlabel FROM pg_enum e
                           WHERE e.enumtypid = to_regtype(v_base)
                           ORDER BY e.enumsortorder LIMIT 1)) || '::' || v_base
    ELSE 'NULL::' || v_base
  END;
END;
$$;

REVOKE ALL ON FUNCTION probe_literal_for(TEXT) FROM PUBLIC, anon, authenticated;

-- The same question, asked with the function in front of you.
--
-- probe_literal_for() answers from the type alone, so every text argument gets
-- 'blueplm_gate_probe'. No argument validation anywhere accepts that string,
-- which makes it easy for a function to refuse the probe for a reason that has
-- nothing to do with authorization - and the probe's whole purpose is to reach
-- the gate and watch it fire. A function whose first statement is
--
--   IF p_image_type NOT IN ('icon', 'image') THEN RAISE EXCEPTION ...
--
-- never executes another line while being probed, so the behavioural half of
-- check_org_gates()'s conjunction is satisfied by an argument check and the
-- source half carries the verdict alone. Reading the source alone is what the
-- release before last did, and it certified a gate written inside `IF false`.
--
-- Where the function itself says which values it will take, take one of them.
-- The literals are read from the raw source rather than from strip_sql_noise()'s
-- output for the obvious reason that this is the one caller that wants the
-- string literals kept. A literal quoted in a comment could mislead it; the
-- consequence is a probe argument that is merely as bad as the old default.
--
-- NOT IN is deliberately not used as a source of values: it says what the
-- function refuses, and 'blueplm_gate_probe' is already outside any such list.
CREATE OR REPLACE FUNCTION probe_literal_for_arg(p_oid OID, p_arg TEXT, p_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_base TEXT := lower(btrim(p_type));
  v_src TEXT;
  v_lit TEXT;
BEGIN
  -- Only text-shaped arguments. A uuid or an integer has no vocabulary to read
  -- off, and enums are already handled by label in probe_literal_for().
  IF p_arg IS NULL
     OR v_base NOT IN ('text', 'character varying', 'varchar', 'name', 'citext',
                       'char', 'character') THEN
    RETURN probe_literal_for(p_type);
  END IF;

  SELECT lower(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_src
  FROM pg_proc p WHERE p.oid = p_oid;

  IF v_src IS NULL THEN
    RETURN probe_literal_for(p_type);
  END IF;

  -- x IN ('a', ...), but not x NOT IN ('a', ...). Captured rather than excluded
  -- with a lookbehind so the intent is legible in the pattern.
  SELECT m[2] INTO v_lit
  FROM regexp_matches(v_src, '(not +)?\m' || p_arg || '\M *in *\( *''([^'']*)''', 'g') AS m
  WHERE m[1] IS NULL
  LIMIT 1;

  -- x = 'a', and 'a' = x.
  IF v_lit IS NULL THEN
    v_lit := (regexp_match(v_src, '\m' || p_arg || '\M *= *''([^'']*)'''))[1];
  END IF;
  IF v_lit IS NULL THEN
    v_lit := (regexp_match(v_src, '''([^'']*)'' *= *\m' || p_arg || '\M'))[1];
  END IF;

  IF v_lit IS NULL OR v_lit = '' THEN
    RETURN probe_literal_for(p_type);
  END IF;

  RETURN quote_literal(v_lit) || '::' || v_base;
END;
$$;

REVOKE ALL ON FUNCTION probe_literal_for_arg(OID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Call every org-scoped RPC with an organization id the caller has nothing to do
-- with, and report the ones that do not refuse.
--
-- Reading the source for the string 'require_org_member' proves that the words
-- are present, not that they run. A check inside `IF false THEN ... END IF;`
-- survives comment-stripping and satisfies the manifest, and so would a call
-- placed after the work it is supposed to guard. This asks the function instead.
--
-- Each call is made inside a subtransaction that is always rolled back, so a
-- function that fails to refuse does not get to keep whatever it did. The
-- rollback is forced by raising a sentinel immediately after the call returns;
-- catching the sentinel is precisely the signal that no gate fired.
--
-- Run this as a role with no JWT - the Supabase SQL editor connects as postgres,
-- where auth.uid() is NULL - so require_org_member() raises 'Not authenticated'
-- and the probe never depends on inventing a plausible organization id.
--
-- Refusal takes two forms here and both count. Most functions raise; the older
-- ones return `{"success": false, "error": ...}` or, if they return a set, the
-- empty set. What is being looked for is a function that goes ahead and answers.
--
-- A gate placed after the work it guards reads as gated, and that is right: the
-- raise aborts the statement, so neither the writes nor the rows reach the
-- caller. It is fragile rather than broken.
--
-- Scope is the p_org_id class, where the organization is an argument and the
-- call can be synthesized. Functions that reach an organization through an
-- entity id are covered by check_unbound_entity_args() and by the manifest's
-- `requires` column instead, because probing those would mean creating a
-- foreign file to aim at.
--
-- TWO THINGS THIS VERSION DOES DIFFERENTLY, AND WHY
--
-- It used to fill every argument but p_org_id with NULL, and accept any P0001
-- or any returned {"success": false} as a refusal. Both halves of that were
-- wrong in the same direction: a function that validates some *other* argument
-- first refuses the probe, is scored gated, and is never asked the question the
-- probe exists to ask. Two functions with no authorization of any kind in them
-- were scored gated and stamped, and then read another organization's data.
--
-- So: the other arguments are filled with values a function can get past -
-- probe_literal_for_arg() below, which reads the function's own vocabulary
-- where it has one - which is what lets execution reach the gate; and a refusal
-- is only credited when it can be *attributed* to an authorization check,
-- meaning the function's own source calls one. The two tests are a conjunction
-- and each covers the other's blind spot:
--
--   a check inside `IF false THEN`  -> source has it, behaviour answers -> ungated
--   a NOT NULL violation, no gate   -> behaviour refuses, source has none -> ungated
--
-- Neither test alone would catch both, and reading the source alone is what the
-- release before last did.
--
-- AND ATTRIBUTION IS EXACTLY AS GOOD AS ITS TOKEN LIST
--
-- The conjunction is only as strong as what the source half counts. It counted
-- `auth.uid()`, which is who is asking and not whether they may, so a function
-- with no authorization whatsoever - one line, `v_actor UUID := auth.uid();` -
-- was scored gated, stamped, and read another tenant's parts over HTTP. It
-- counted `is_org_admin()` too, which is a real check about the wrong
-- organization. See c_gate_binding below for what is left and why, and for the
-- ten RPCs that had to change so that removing them cost nothing true.

-- WHY A FUNCTION IS NOT PROBED, DECIDED FROM THE ACL AND NOT FROM A LIST
--
-- check_org_gates() used to carry two hardcoded arrays of names it skipped.
-- One of them, c_trigger_only, was described as "only ever called by a
-- trigger", and it held seed_customer_categories - a SECURITY DEFINER function
-- that anyone with a login could call over PostgREST against any organization,
-- for as long as the array said not to look. The claim was about how the
-- function is *called*; what mattered was who is *allowed* to call it, and
-- nothing checked that.
--
-- So the question is asked of the database instead:
--
--   'predicate' - one of the two gates the other functions are gated BY.
--                 Probing a gate for a refusal has no failing answer, so this
--                 exemption is about the shape of the question, not the ACL.
--                 posture-checks.sql exercises both directly.
--   'withdrawn' - no PostgREST role may execute it. It cannot be handed a
--                 foreign organization id because it cannot be called at all.
--   NULL        - probe it.
--
-- 'withdrawn' is the important one: it lasts exactly as long as the ACL does.
-- Grant the function back to anon or authenticated - which is what Supabase's
-- default privileges do to every function postgres creates - and this returns
-- NULL on the next run and the probe takes over.
CREATE OR REPLACE FUNCTION org_gate_exclusion_reason(p_oid OID)
RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p.oid::regprocedure::TEXT IN ('is_org_member(uuid)', 'require_org_member(uuid)')
      THEN 'predicate'
    WHEN NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      THEN 'withdrawn'
  END
  FROM pg_proc p
  WHERE p.oid = p_oid;
$$;

REVOKE ALL ON FUNCTION org_gate_exclusion_reason(OID) FROM PUBLIC, anon, authenticated;

-- Which check_org_gates() verdicts withhold the stamp, in one place, because
-- the answer was previously a literal inside verify_and_stamp_schema() that
-- named 'ungated' alone. 'unverifiable' - reachable, and not shown to refuse -
-- has to block too, or a probe that failed to reach a verdict is worth exactly
-- as much as one that certified the function.
CREATE OR REPLACE FUNCTION org_gate_status_blocks(p_status TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_status IN ('ungated', 'unverifiable');
$$;

REVOKE ALL ON FUNCTION org_gate_status_blocks(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION check_org_gates()
RETURNS TABLE (signature TEXT, status TEXT, detail TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  -- WHAT MAKES A REFUSAL ATTRIBUTABLE
  --
  -- A call that ties the caller to the organization the function was asked
  -- about. Nothing weaker, and the list used to contain three weaker things.
  --
  -- `auth.uid()` was the worst of them. It answers "who is asking", which is a
  -- stamp and not a gate, and a function whose only recognised token was
  --
  --   DECLARE v_actor UUID := auth.uid();
  --
  -- with no authorization of any kind anywhere in it scored gated, was stamped
  -- by verify_and_stamp_schema(), and served one tenant another tenant's parts
  -- over HTTP. `current_actor_id()` is the same answer that raises when the
  -- answer is nobody: it establishes that somebody is signed in, and signing up
  -- is free. `is_org_admin()`, `user_has_permission()` and
  -- `user_has_team_permission()` are genuine authorization checks and still not
  -- these: they ask what the caller may do in their OWN organization and take
  -- no p_org_id, so an admin of one tenant passes them while naming another.
  --
  -- Removing them is only honest if the code stops depending on them, and ten
  -- RPCs did - each hand-writing `SELECT org_id INTO v FROM users WHERE id =
  -- auth.uid()` and comparing it to p_org_id. Every one was correct, and their
  -- correctness is why this list had to be wrong: the checker was widened to
  -- accommodate the convention instead of the convention being kept. They call
  -- require_org_member() or is_org_member() now, which is what
  -- check_null_unsafe_org_gates() has told people to do for two releases.
  --
  -- Named c_gate_binding rather than c_gate_evidence because the change is what
  -- counts as evidence, and a build carrying the old copy should not satisfy the
  -- manifest by accident.
  c_gate_binding CONSTANT TEXT :=
    '(require_org_member|is_org_member|require_same_org_user|require_\w+_access)\s*\(';
  r RECORD;
  v_args TEXT;
  v_sqlstate TEXT;
  v_message TEXT;
  v_rows TEXT[];
  v_attributable BOOLEAN;
  v_excuse TEXT;
  v_reachable BOOLEAN;
BEGIN
  FOR r IN
    SELECT p.oid,
           p.proname,
           p.oid::regprocedure::TEXT AS sig,
           pg_get_function_identity_arguments(p.oid) AS ident_args,
           -- prosrc, so a function does not match c_gate_evidence on its own
           -- name in the CREATE line that pg_get_functiondef() prepends.
           lower(regexp_replace(strip_sql_noise(p.prosrc), '\s+', ' ', 'g')) AS src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      -- Functions only. A procedure is reached by CALL, not by SELECT, and no
      -- org-scoped procedure exists; check_unbound_entity_args() and the anon
      -- sweep both cover procedures, so one is not invisible everywhere.
      AND p.prokind = 'f'
      AND pg_get_function_identity_arguments(p.oid) ~ '\mp_org_id\M'
    ORDER BY 1
  LOOP
    -- AN EXCLUSION HAS TO EARN ITSELF, ON THE DATABASE IN FRONT OF IT
    --
    -- This loop used to skip three function names outright, and the skip was
    -- silent: nothing downstream could tell an excluded function from one that
    -- had never existed. seed_customer_categories was on that list with a
    -- comment saying its grant had been withdrawn, the withdrawal named PUBLIC
    -- and not authenticated, and the function stayed callable over PostgREST
    -- for as long as the list said not to look. A list of names cannot notice
    -- that; org_gate_exclusion_reason() reads the ACL, so the excuse expires
    -- the moment the ACL does.
    --
    -- Excused functions are still returned, with the reason and the ACL that
    -- justifies it, so "not checked" is a line in the report rather than an
    -- absence from it.
    v_excuse := org_gate_exclusion_reason(r.oid);
    IF v_excuse IS NOT NULL THEN
      signature := r.sig;
      status := v_excuse;
      detail := CASE v_excuse
        WHEN 'withdrawn' THEN
          'not probed: neither anon nor authenticated may execute it, so no '
          || 'PostgREST caller can reach it and the argument it trusts cannot be '
          || 'supplied by one. This is the whole of its defence - grant it back '
          || 'to either role and it is probed like everything else. ACL: '
          || COALESCE((SELECT p.proacl::TEXT FROM pg_proc p WHERE p.oid = r.oid),
                      '(default - which on Supabase means anon and authenticated CAN execute it)')
        ELSE
          'not probed: this is one of the gates the others are gated BY. '
          || 'is_org_member(p_org_id) answering false for a foreign organization '
          || 'is the gate working, and require_org_member(p_org_id) raising is '
          || 'the same answer spelled as an exception, so probing it for a '
          || 'refusal asks a question with no failing answer. Neither discloses '
          || 'anything beyond whether the caller themselves is a member. They '
          || 'are exercised directly, as four different callers, by '
          || 'harness/sql/posture-checks.sql.'
      END;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Whether a verdict of "could not tell" is survivable. For a function no
    -- PostgREST caller can reach, not knowing costs nothing. For one they can,
    -- it is the same silence the exclusion list used to provide.
    v_reachable := has_function_privilege('authenticated', r.oid, 'EXECUTE')
                OR has_function_privilege('anon', r.oid, 'EXECUTE');

    v_attributable := r.src ~ c_gate_binding;

    -- A random organization id for p_org_id, and for every other argument a
    -- value of its own type that the function has some chance of accepting.
    -- NULLs here were how a function got certified without its org gate ever
    -- being reached: it rejected the NULL first and the probe called that a
    -- refusal. probe_literal_for_arg() goes one further and reads the function's
    -- own vocabulary, so an argument the function only accepts from a fixed set
    -- is filled from that set rather than with a string nothing accepts.
    SELECT string_agg(
             CASE WHEN a.arg ~ '\mp_org_id\M'
                  THEN quote_literal(gen_random_uuid()::text) || '::uuid'
                  ELSE probe_literal_for_arg(r.oid, split_part(a.arg, ' ', 1),
                                             regexp_replace(a.arg, '^\S+\s+', '')) END,
             ', ' ORDER BY a.ord)
      INTO v_args
      FROM unnest(string_to_array(r.ident_args, ', ')) WITH ORDINALITY AS a(arg, ord);

    BEGIN
      -- The FROM form works for scalar and set-returning functions alike, and
      -- array_agg keeps every row rather than the first, so a set-returning
      -- function that leaked rows cannot be mistaken for one that returned none.
      EXECUTE format(
        'SELECT array_agg(probe.*::text) FROM (SELECT * FROM %s(%s)) probe',
        r.proname, v_args)
        INTO v_rows;
      -- It answered. Undo anything it did and carry the verdict out on the
      -- sentinel's message, since the rollback discards v_rows with everything
      -- else the call touched.
      RAISE EXCEPTION 'blueplm_gate_probe_sentinel'
        USING ERRCODE = 'raise_exception',
              DETAIL = COALESCE(array_to_string(v_rows, ' | '), '');
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;

        IF v_message = 'blueplm_gate_probe_sentinel' THEN
          GET STACKED DIAGNOSTICS v_message = PG_EXCEPTION_DETAIL;
          signature := r.sig;

          IF v_message = '' THEN
            -- The empty set: a set-returning function that bailed with a bare
            -- RETURN rather than raising.
            status := CASE WHEN v_attributable THEN 'gated' ELSE 'ungated' END;
            detail := CASE WHEN v_attributable THEN 'returned no rows'
                      ELSE 'returned no rows, but nothing in its source ties the '
                        || 'caller to the organization it was asked about, so the '
                        || 'empty result is not a refusal - it is a query that '
                        || 'happened to match nothing' END;
          -- record::text doubles the quotes inside a JSON column, so
          -- {"success" : false} arrives as ("{""success"" : false}").
          ELSIF replace(v_message, '""', '"') ~ '"success"\s*:\s*false' THEN
            -- The older convention: refusal reported in the JSON payload.
            status := CASE WHEN v_attributable THEN 'gated' ELSE 'ungated' END;
            detail := CASE WHEN v_attributable THEN left(v_message, 200)
                      ELSE 'returned ' || left(v_message, 120) || ' - but nothing in '
                        || 'its source ties the caller to the organization it was '
                        || 'asked about, so this is some other argument being '
                        || 'rejected, not an authorization check' END;
          ELSE
            status := 'ungated';
            detail := 'ran to completion against an organization the caller does '
                   || 'not belong to, returning: ' || left(v_message, 160);
          END IF;
          RETURN NEXT;
        ELSIF v_sqlstate IN ('42501', '28000', '22023', 'P0001') THEN
          -- insufficient_privilege / invalid_authorization_specification /
          -- invalid_parameter_value, and P0001, which nothing but a deliberate
          -- RAISE in the function's own body produces.
          --
          -- A deliberate RAISE is still only a refusal if the function has
          -- something to refuse *with*. 'p_name is required' is a P0001 and is
          -- not a gate, and scoring it as one is how a function with no
          -- authorization at all came to be certified.
          signature := r.sig;
          IF v_attributable THEN
            status := 'gated';
            detail := v_message;
          ELSE
            status := 'ungated';
            detail := 'refused with "' || left(v_message, 120) || '", but nothing in '
                   || 'its source ties the caller to the organization it was asked '
                   || 'about - no require_org_member, is_org_member, '
                   || 'require_..._access or require_same_org_user. auth.uid(), '
                   || 'current_actor_id() and is_org_admin() do not count: the first '
                   || 'two say who is asking and the third says what they may do in '
                   || 'their own organization, and none of them looks at p_org_id. '
                   || 'The refusal is about some other argument, and a caller who '
                   || 'supplies that argument correctly is served whatever '
                   || 'organization they name.';
          END IF;
          RETURN NEXT;
        ELSE
          -- Something else went wrong - a missing table from a module that is
          -- not installed, a NULL argument the function dereferenced before
          -- reaching its gate, a foreign key the synthesized organization id
          -- does not satisfy. Not a pass and not a failure.
          --
          -- WHICH DOES NOT MEAN IT CAN BE WAVED THROUGH
          --
          -- 'inconclusive' was reported and then ignored: verify_and_stamp_schema()
          -- selected only 'ungated', so a reachable function this probe could
          -- not judge was indistinguishable from one it had judged safe. That is
          -- the exclusion list again, arrived at by accident instead of by a
          -- list - and it is how a function whose defence is nothing but its ACL
          -- gets stamped after somebody grants the ACL away.
          --
          -- So the verdict splits on reachability, which is the thing that
          -- decides whether not knowing matters. 42P01 is carved out because an
          -- undefined table means the module that owns it is not installed, and
          -- a partial install must stay verifiable - that failure is about the
          -- database's contents, not about this function's authorization.
          signature := r.sig;
          IF v_reachable AND v_sqlstate <> '42P01' THEN
            status := 'unverifiable';
            detail := 'anon or authenticated may execute it and the probe could '
                   || 'not establish that it refuses a foreign organization: it '
                   || 'failed with ' || v_sqlstate || ': ' || left(v_message, 140)
                   || '. That is not a refusal - nothing in it is attributable to '
                   || 'an authorization check - and it is not a pass. Either gate '
                   || 'the function with require_org_member(p_org_id), or withdraw '
                   || 'it with REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, '
                   || 'authenticated if it has no client caller.';
          ELSE
            status := 'inconclusive';
            detail := v_sqlstate || ': ' || v_message
                   || CASE WHEN NOT v_reachable
                           THEN ' (not reachable by anon or authenticated, so this costs nothing)'
                           ELSE ' (the module that owns the missing table is not installed)' END;
          END IF;
          RETURN NEXT;
        END IF;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION check_org_gates() FROM PUBLIC, anon, authenticated;

-- Everything an unauthenticated caller can still reach.
--
-- Supabase's bootstrap runs ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL
-- ON FUNCTIONS TO postgres, anon, authenticated, service_role, so every function
-- created in public is born with an explicit anon grant and stays that way
-- unless something takes it away. enforce_anon_execute_posture() is what takes
-- it away; this is the check that it did, and the one that notices the next
-- function somebody adds without running it.
--
-- WHY THERE IS A severity COLUMN
--
-- The previous version returned one undifferentiated list and
-- verify_and_stamp_schema() treated every row in it as fatal. Supabase creates a
-- default-privilege entry owned by supabase_admin as well as the one owned by
-- postgres, and `postgres` is not a member of supabase_admin, so
-- `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ...` raises
-- insufficient_privilege no matter who runs it from the SQL editor.
-- enforce_anon_execute_posture() warned and moved on, this function reported the
-- row, and the stamp was withheld - permanently, on a correctly installed
-- database, with all 35 manifest objects reporting ok. The advice printed
-- alongside was to run the very function that had just failed.
--
-- A check the operator cannot act on must not be able to block them. Rows are
-- 'blocking' or 'advisory', and only 'blocking' withholds the stamp. The line
-- between them is one question, asked the same way everywhere: *could the
-- caller revoke this if they wanted to?* If yes it is blocking, because it is
-- their job. If no it is advisory, because otherwise the script is demanding
-- something impossible - which is exactly what v90 did, while advising the
-- operator to run the function that had just failed to do it.
-- tools/emergency-lockdown.sql draws the same line, so the two agree about
-- what "clean" means.
--
-- WHERE THAT LINE IS DANGEROUS, AND WHAT KEEPS IT HONEST
--
-- 'advisory' is a way for a real exposure to not stop a release, so it has to
-- be narrow. Two rules hold it in place:
--
--   1. Advisory is decided by the catalogue, not by a judgement call:
--      anon_revoke_grantors() lists the roles that granted anon the privilege,
--      and the row is advisory only when the caller is a member of none of
--      them and is not a superuser. Anything the caller *can* revoke stays
--      blocking however inconvenient.
--   2. Advisory is never quiet. tools/verify-schema.sql prints advisory rows
--      above the summary and calls out the ones that are live objects rather
--      than policies, because "you cannot fix this from here" is not the same
--      sentence as "this is fine".
--
-- The original advisory case - a default-privilege row owned by supabase_admin
-- - was safe for a further reason worth keeping in mind: it describes a policy,
-- and every object the policy produces is still swept and still reported. An
-- object that is itself unrevokable has no such backstop, which is why it is
-- printed with the detail spelled out rather than folded into a count.
DROP FUNCTION IF EXISTS check_anon_reach() CASCADE;

-- Who granted anon its EXECUTE on this routine - directly, or through PUBLIC.
--
-- REVOKE only removes grants made by the current role or by a role it is a
-- member of, so this is the list of roles the caller would have to be able to
-- act as. On Supabase a routine created by supautils' CREATE EXTENSION comes
-- out `anon=X/supabase_admin`, postgres is not a member of supabase_admin, and
-- `REVOKE EXECUTE ... FROM anon` answers "WARNING: no privileges could be
-- revoked" and changes nothing.
--
-- COALESCE onto acldefault() because a NULL proacl is not "no privileges" - it
-- means the built-in default is in force, which for a routine is EXECUTE to
-- PUBLIC, granted by the owner.
CREATE OR REPLACE FUNCTION anon_revoke_grantors(p_oid OID)
RETURNS TEXT[]
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_agg(DISTINCT pg_get_userbyid(x.grantor)), '{}'::TEXT[])
  FROM pg_proc p
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
  WHERE p.oid = p_oid
    AND x.privilege_type = 'EXECUTE'
    -- grantee 0 is PUBLIC, which anon holds through.
    AND (x.grantee = 0 OR pg_has_role('anon', x.grantee, 'MEMBER'));
$$;

REVOKE ALL ON FUNCTION anon_revoke_grantors(OID) FROM PUBLIC, anon, authenticated;

-- The same question for a relation's SELECT. Separate from the routine version
-- rather than one polymorphic helper, because pg_proc.oid and pg_class.oid are
-- different spaces that can hold the same number, and a lookup that searched
-- both could answer about the wrong object.
CREATE OR REPLACE FUNCTION anon_read_grantors(p_oid OID)
RETURNS TEXT[]
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_agg(DISTINCT pg_get_userbyid(x.grantor)), '{}'::TEXT[])
  FROM pg_class c
  CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) x
  WHERE c.oid = p_oid
    AND x.privilege_type = 'SELECT'
    AND (x.grantee = 0 OR pg_has_role('anon', x.grantee, 'MEMBER'));
$$;

REVOKE ALL ON FUNCTION anon_read_grantors(OID) FROM PUBLIC, anon, authenticated;

-- Policies on this relation that let anon see every row.
--
-- ENABLING ROW-LEVEL SECURITY IS NOT EXCLUDING ANON
--
-- The table sweep below treats `relrowsecurity = true` as the end of the
-- question, and it is not even the beginning of it. RLS decides that policies
-- apply; the policies decide who sees what. A table with
--
--   ALTER TABLE t ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY p ON t FOR SELECT TO anon USING (true);
--
-- has row-level security switched on and is readable at GET /rest/v1/t with no
-- JWT. That was verified over HTTP against this release's predecessor while
-- check_anon_reach() returned nothing and the schema was stamped.
--
-- WHAT THIS CAN AND CANNOT SEE
--
-- "Does this policy exclude anon?" is not decidable from the expression in
-- general - `USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()))`
-- excludes anon only because auth.uid() is NULL for it, which is a fact about
-- the platform and not about the text. So this asks the narrow, decidable
-- question instead: is there a permissive SELECT policy, applying to anon
-- directly or through PUBLIC, whose USING expression is the constant true? That
-- is the shape that admits anon to everything, and it is the shape somebody
-- writes by accident when they want a table readable by the sign-in screen.
--
-- A qual of `1 = 1`, or one that reduces to true through a function, is not
-- caught. Stating that is better than implying a completeness this cannot have;
-- the allowlist below is what makes the deliberate cases explicit, so anything
-- else arriving is at least visible in a diff.
--
-- Restrictive policies are ignored: they can only subtract from what a
-- permissive one grants, so one can never be the reason anon sees a row.
CREATE OR REPLACE FUNCTION anon_admitting_policies(p_oid OID)
RETURNS TEXT[]
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_agg(pol.polname ORDER BY pol.polname), '{}'::TEXT[])
  FROM pg_policy pol
  WHERE pol.polrelid = p_oid
    AND pol.polpermissive
    -- 'r' is SELECT, '*' is ALL. The others cannot return a row to a reader.
    AND pol.polcmd IN ('r', '*')
    AND EXISTS (
      SELECT 1 FROM unnest(pol.polroles) AS rid
      -- 0 is PUBLIC, which anon holds through.
      WHERE rid = 0 OR pg_has_role('anon', rid, 'MEMBER')
    )
    AND COALESCE(pg_get_expr(pol.polqual, pol.polrelid), 'true') = 'true';
$$;

REVOKE ALL ON FUNCTION anon_admitting_policies(OID) FROM PUBLIC, anon, authenticated;

-- Relations an unauthenticated caller is deliberately allowed to read, the
-- counterpart of anon_execute_allowlist() for tables and views.
--
-- Same rule: keep it short and justify every entry, because a relation here is
-- readable over PostgREST by anyone on the internet holding the publishable
-- key. It exists so that the deliberate case and the accidental case can be
-- told apart at all - without it, the policy check above would report the one
-- table that is meant to be public and an operator would learn to ignore it.
CREATE OR REPLACE FUNCTION anon_read_allowlist()
RETURNS TABLE (relname TEXT, reason TEXT)
LANGUAGE sql IMMUTABLE AS $$
  SELECT * FROM (VALUES
    -- One row, holding an integer, a description of the release and when it was
    -- stamped. It names no organization and no person, and the app compares it
    -- against the version it was built for. Its SELECT policy is USING (true)
    -- on purpose.
    ('schema_version', 'the recorded schema version, which names no tenant')
  ) AS a(relname, reason);
$$;

-- ANON HOLDS SELECT, INSERT, UPDATE AND DELETE ON EVERY TABLE IN public
--
-- Supabase's bootstrap runs ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL
-- ON TABLES TO anon, so every table this schema creates is born with all four
-- granted to the unauthenticated role. 101 of 102 hold it - schema_version is
-- the exception only because it is on the allowlist above. Nothing but
-- row-level security stands between an anonymous caller holding the publishable
-- key and every row in the database.
--
-- That is stated here, in the schema, rather than left as an observation
-- somewhere, because the question "should we revoke them?" has a measured
-- answer and the answer has a sequence to it.
--
-- WHAT WAS MEASURED, IN THE HARNESS
--
-- harness/sql/anon-table-grants-experiment.sql revokes all four from anon on
-- every relation in public except the allowlist, withdraws the default
-- privilege, and then the full suite runs against it:
--
--   * 18 of 18 attacks refused - unchanged;
--   * 12 of 12 positive controls still working - unchanged.
--
-- Nothing broke, because every path the product uses is either a SECURITY
-- DEFINER function - which executes as its owner and does not consult the
-- caller's table grants at all - or an authenticated request, which uses
-- `authenticated`, untouched by any of this.
--
-- WHY IT IS NOT IN THIS RELEASE ANYWAY
--
-- The app makes exactly two unauthenticated table requests, both SELECT on
-- organizations, and both already return nothing because that table's policies
-- admit only authenticated. Both tolerate an error. So far so safe.
--
-- The API server makes a third. api/src/infrastructure/supabase.ts,
-- checkDatabaseHealth(), does `client.from('organizations').select('id')` with
-- the bare anon key and reports the database UNHEALTHY on any error. Measured
-- over HTTP in the harness: with the grant, anon gets `200 []`; without it,
-- `401 {"code":"42501","message":"permission denied for table organizations"}`.
-- So revoking flips /health to unhealthy, and on a platform that reads that
-- endpoint - Railway, Render, Fly - the API is pulled out of rotation. That is
-- the silent breakage this kind of change is warned about, and it is silent in
-- the worst way: the schema change and the deployment that notices it are
-- weeks apart.
--
-- THE SEQUENCE, FOR WHOEVER PICKS THIS UP
--
--   1. Change checkDatabaseHealth() to something that does not depend on an
--      anon table grant - `select version()` over an RPC on
--      anon_execute_allowlist(), or the /health probe the platform already has.
--      That is an api/ change and it ships on the API's own version.
--   2. Deploy it, and confirm no other consumer of the publishable key reads a
--      table. The two in the desktop app are listed above; a new one would be
--      a new call site, and this note is what tells its author to look.
--   3. Then revoke, in the sweep at the end of each module, alongside the
--      routine posture: REVOKE ALL ON TABLE ... FROM anon for everything not on
--      anon_read_allowlist(), plus ALTER DEFAULT PRIVILEGES ... REVOKE ALL ON
--      TABLES FROM anon so the next table is born closed. The experiment file
--      is that statement, already written.
--
-- AND WHAT IS TRUE IN THE MEANTIME
--
-- "Check instead that every table's policy provably excludes anon" is the
-- appealing alternative and it is only partly available: whether a policy
-- excludes anon is not decidable from its expression. `USING (org_id IN (SELECT
-- org_id FROM users WHERE id = auth.uid()))` excludes anon because auth.uid()
-- is NULL for it, which is a fact about the platform and not about the text.
-- What check_anon_reach() does cover is the two decidable cases: row-level
-- security switched off at all, and a permissive SELECT policy reaching anon
-- whose USING is the constant true. Both withhold the stamp. Between them they
-- catch every way a table has actually been left open here, and neither is a
-- proof of exclusion in general. Saying that plainly is worth more than a check
-- that implies a completeness it cannot have.

CREATE OR REPLACE FUNCTION check_anon_reach()
RETURNS TABLE (kind TEXT, identity TEXT, severity TEXT, detail TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  v_super BOOLEAN := COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false);
BEGIN
  -- Every routine, not just prokind = 'f'.
  --
  -- This sweep and enforce_anon_execute_posture() have to agree about what a
  -- routine is, or the check reports something the remedy cannot clear. They
  -- did not: this had no prokind filter and the sweep had `prokind = 'f'`, so a
  -- PROCEDURE created in public by a later migration was reported blocking, the
  -- sweep answered "0 objects", and the operator was told to run a function
  -- that would never touch it. That is the v90 defect - a condition with no way
  -- out - relocated rather than fixed.
  RETURN QUERY
  SELECT CASE p.prokind WHEN 'p' THEN 'procedure' WHEN 'a' THEN 'aggregate'
                        WHEN 'w' THEN 'window' ELSE 'function' END::TEXT,
         p.oid::regprocedure::TEXT,
         CASE WHEN v_super OR NOT EXISTS (
                SELECT 1 FROM unnest(anon_revoke_grantors(p.oid)) g
                WHERE NOT pg_has_role(current_user, g, 'MEMBER'))
              THEN 'blocking' ELSE 'advisory' END::TEXT,
         CASE WHEN v_super OR NOT EXISTS (
                SELECT 1 FROM unnest(anon_revoke_grantors(p.oid)) g
                WHERE NOT pg_has_role(current_user, g, 'MEMBER'))
           THEN 'executable by anon and not in anon_execute_allowlist(). '
                || 'Run: SELECT enforce_anon_execute_posture();'
           ELSE 'EXECUTABLE BY ANON, and you cannot revoke it: the grant was made by '
                || array_to_string(anon_revoke_grantors(p.oid), ', ')
                || ' and ' || current_user || ' is a member of neither that role nor '
                || 'any superuser. This is what supautils produces when CREATE '
                || 'EXTENSION installs an extension into public - the routines come '
                || 'out owned by supabase_admin. Advisory, because a check the '
                || 'operator has no power to clear must not withhold the stamp for '
                || 'ever; REAL, because anon can call it right now. Move the '
                || 'extension out of public (CREATE EXTENSION ... SCHEMA extensions, '
                || 'or ALTER EXTENSION ... SET SCHEMA extensions), or ask Supabase '
                || 'support to revoke it. BluePLM itself installs no extensions.'
         END
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1 FROM anon_execute_allowlist() a
      WHERE a.signature = p.oid::regprocedure::TEXT
         OR a.signature = p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    )
  ORDER BY 2;

  -- A table without RLS is readable by anon directly, no function needed.
  -- ALTER TABLE ... ENABLE ROW LEVEL SECURITY needs ownership, so the same
  -- "could the caller actually do this?" question decides the severity. Every
  -- BluePLM table is owned by the installing role, so this is blocking for all
  -- of them; a table an extension left in public is not.
  --
  -- relkind IN ('r','p','f'), not 'r'.
  --
  -- 'r' is an ordinary table and it is the only shape this used to look at.
  --
  --   'p' is a partitioned table. Its leaf partitions are 'r' and were caught,
  --       which reads as adequate until row-level security is enabled on a
  --       leaf: the leaf then drops out of this sweep, the parent was never in
  --       it, and SELECT through the parent - which is how anyone queries a
  --       partitioned table - applies the parent's policies, of which there
  --       are none. Verified over HTTP: anon read every row of a partitioned
  --       table in public while this function returned nothing.
  --   'f' is a foreign table, which cannot carry row-level security at all and
  --       reaches data this database does not even hold.
  --
  -- Partitions themselves are excluded (relispartition): a leaf is reached
  -- through its parent, the parent is now swept, and reporting both would tell
  -- the operator to fix the same exposure once per partition.
  RETURN QUERY
  SELECT CASE c.relkind WHEN 'p' THEN 'partitioned table'
                        WHEN 'f' THEN 'foreign table' ELSE 'table' END::TEXT,
         c.relname::TEXT,
         CASE WHEN v_super OR pg_has_role(current_user, c.relowner, 'MEMBER')
              THEN 'blocking' ELSE 'advisory' END::TEXT,
         CASE WHEN v_super OR pg_has_role(current_user, c.relowner, 'MEMBER')
           THEN 'has no row-level security, so anon reads it directly over PostgREST. '
                || 'Fix: ALTER TABLE ' || quote_ident(c.relname)
                || ' ENABLE ROW LEVEL SECURITY, then add the policies it needs.'
           ELSE 'READABLE BY ANON with no row-level security, and you cannot enable '
                || 'it: the table is owned by ' || pg_get_userbyid(c.relowner)
                || ' and ' || current_user || ' is not a member of that role. Not '
                || 'created by BluePLM. Advisory only because there is nothing you '
                || 'can run from here that changes it.'
         END
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'f')
    AND NOT c.relispartition
    AND NOT c.relrowsecurity
    AND NOT EXISTS (SELECT 1 FROM anon_read_allowlist() a WHERE a.relname = c.relname)
  ORDER BY 2;

  -- Row-level security switched on, and a policy that hands anon every row.
  --
  -- The block above answers "is RLS off?" and stops. That is not the same
  -- question as "is anon excluded?", and the gap between them is a whole class
  -- of exposure: RLS on, `CREATE POLICY ... FOR SELECT TO anon USING (true)`,
  -- and the table is public at GET /rest/v1/<table> with no JWT while every
  -- inventory in this file calls it protected. Measured over HTTP against the
  -- previous release; check_anon_reach() returned nothing and the schema was
  -- stamped.
  --
  -- See anon_admitting_policies() for what this can and cannot recognise. It is
  -- the narrow case - a permissive SELECT policy reaching anon whose USING is
  -- the constant true - and it is the one that gets written by accident.
  RETURN QUERY
  SELECT CASE c.relkind WHEN 'p' THEN 'partitioned table'
                        WHEN 'm' THEN 'matview' WHEN 'v' THEN 'view'
                        ELSE 'table' END::TEXT,
         c.relname::TEXT,
         CASE WHEN v_super OR pg_has_role(current_user, c.relowner, 'MEMBER')
              THEN 'blocking' ELSE 'advisory' END::TEXT,
         'has row-level security enabled and a policy that admits anon to every '
           || 'row: ' || array_to_string(anon_admitting_policies(c.oid), ', ')
           || '. Enabling row-level security decides that policies apply; it does '
           || 'not decide who they let in, and USING (true) lets in whoever the '
           || 'policy names. Either scope the policy''s USING expression to the '
           || 'caller''s organization, or restrict the policy to authenticated: '
           || 'DROP POLICY ' || quote_ident((anon_admitting_policies(c.oid))[1])
           || ' ON ' || quote_ident(c.relname) || '; and write it again with the '
           || 'roles and the predicate it needs. If the relation is genuinely '
           || 'meant to be public, add it to anon_read_allowlist() with a reason.'
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND NOT c.relispartition
    AND c.relrowsecurity
    AND has_any_column_privilege('anon', c.oid, 'SELECT')
    AND array_length(anon_admitting_policies(c.oid), 1) > 0
    AND NOT EXISTS (SELECT 1 FROM anon_read_allowlist() a WHERE a.relname = c.relname)
  ORDER BY 2;

  -- Views. This block is here because nothing in the release before last looked
  -- at them: the table sweep above filters relkind = 'r', and parts_with_pricing
  -- is relkind = 'v'. It was readable at GET /rest/v1/parts_with_pricing with no
  -- JWT at all, returning every organization's file ids, part numbers,
  -- descriptions, paths, revisions, states, preferred supplier, supplier code
  -- and unit price. Both of that release's security checks reported the schema
  -- clean while it did so.
  --
  -- Materialized views used to be folded in here and are now handled on their
  -- own below, because revoking anon is not a sufficient answer for one.
  --
  -- has_any_column_privilege, not has_table_privilege.
  --
  -- A grant can be made on a single column - `GRANT SELECT (part_number) ON
  -- parts_with_pricing TO anon` - and has_table_privilege is false for one,
  -- because it asks about the privilege on the whole relation. PostgREST serves
  -- ?select=part_number from it perfectly happily. Verified: a view with one
  -- column granted was read over HTTP by anon while this returned nothing.
  -- has_any_column_privilege answers true for the table-level grant as well, so
  -- it is a superset and nothing that used to be reported stops being reported.
  RETURN QUERY
  SELECT 'view'::TEXT,
         c.relname::TEXT,
         CASE WHEN v_super OR NOT EXISTS (
                SELECT 1 FROM unnest(anon_read_grantors(c.oid)) g
                WHERE NOT pg_has_role(current_user, g, 'MEMBER'))
              THEN 'blocking' ELSE 'advisory' END::TEXT,
         CASE WHEN v_super OR NOT EXISTS (
                SELECT 1 FROM unnest(anon_read_grantors(c.oid)) g
                WHERE NOT pg_has_role(current_user, g, 'MEMBER'))
           THEN 'readable by anon over PostgREST. A view has no row-level security '
                || 'of its own, so this is an unauthenticated read of whatever it '
                || 'selects. Run: SELECT enforce_anon_execute_posture();'
           ELSE 'READABLE BY ANON, and you cannot revoke it: the grant was made by '
                || array_to_string(anon_read_grantors(c.oid), ', ') || ' and '
                || current_user || ' is not a member of that role. Not created by '
                || 'BluePLM - an extension installed into public leaves views like '
                || 'this. Move the extension to the extensions schema. Advisory only '
                || 'because nothing you can run from here changes it.'
         END
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'v'
    AND has_any_column_privilege('anon', c.oid, 'SELECT')
  ORDER BY 2;

  -- A view that is not security_invoker reads its base tables as the view's
  -- owner. The owner here is postgres, which Supabase's demotion leaves holding
  -- BYPASSRLS, so RLS on files and part_suppliers does not apply and every
  -- tenant's rows come back - to any authenticated caller, not just to anon.
  -- Revoking anon alone would have left that half of the leak open.
  RETURN QUERY
  SELECT 'view'::TEXT,
         c.relname::TEXT,
         CASE WHEN v_super OR pg_has_role(current_user, c.relowner, 'MEMBER')
              THEN 'blocking' ELSE 'advisory' END::TEXT,
         CASE WHEN v_super OR pg_has_role(current_user, c.relowner, 'MEMBER')
           THEN 'is not security_invoker, so it reads its base tables as its owner ('
                || pg_get_userbyid(c.relowner) || ') and row-level security does not '
                || 'apply. Any grantee sees every organization''s rows. Fix: ALTER VIEW '
                || quote_ident(c.relname) || ' SET (security_invoker = true);'
           ELSE 'IS NOT security_invoker and you cannot change that: it is owned by '
                || pg_get_userbyid(c.relowner) || ', which ' || current_user
                || ' is not a member of. Every grantee reads it as its owner. Not '
                || 'created by BluePLM. Advisory only because ALTER VIEW would be '
                || 'refused.'
         END
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'v'
    AND COALESCE((SELECT option_value FROM pg_options_to_table(c.reloptions)
                  WHERE option_name = 'security_invoker'), 'off') NOT IN ('true', 'on')
    AND (has_any_column_privilege('anon', c.oid, 'SELECT')
         OR has_any_column_privilege('authenticated', c.oid, 'SELECT'))
  ORDER BY 2;

  -- Materialized views, which the block above cannot help with.
  --
  -- The security_invoker sweep filters relkind = 'v', and it has to: a
  -- materialized view *cannot* be security_invoker - the option does not exist
  -- for it - and it holds its own stored rows rather than reading base tables,
  -- so it carries no row-level security either. It is therefore strictly worse
  -- than the plain view that caused the original leak, and it produced no row
  -- at all: not in the security_invoker sweep, not in the table sweep
  -- (relkind = 'r'), and only in the anon sweep above if anon in particular
  -- could read it.
  --
  -- None exist in BluePLM today. This is here so that the first one cannot be
  -- added quietly.
  RETURN QUERY
  SELECT 'matview'::TEXT,
         c.relname::TEXT,
         -- Ownership rather than grantor: the remedies are REVOKE, ALTER and
         -- DROP, and all three need to own it. An extension's matview in public
         -- is advisory for the same reason its functions are.
         CASE WHEN v_super OR pg_has_role(current_user, c.relowner, 'MEMBER')
              THEN 'blocking' ELSE 'advisory' END::TEXT,
         'is a materialized view in public readable by '
           || CASE WHEN has_any_column_privilege('anon', c.oid, 'SELECT')
                        AND has_any_column_privilege('authenticated', c.oid, 'SELECT')
                     THEN 'anon and authenticated'
                   WHEN has_any_column_privilege('anon', c.oid, 'SELECT') THEN 'anon'
                   ELSE 'authenticated' END
           || '. A materialized view cannot be security_invoker and has no row-level '
           || 'security of its own, so every grantee sees every organization''s rows '
           || 'and there is no setting that changes that. Either move it out of '
           || 'public and read it through a SECURITY DEFINER function that filters by '
           || 'organization, or replace it with a security_invoker view over the '
           || 'RLS-protected tables. If it must stay: REVOKE ALL ON '
           || quote_ident(c.relname) || ' FROM anon, authenticated;'
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'm'
    AND (has_any_column_privilege('anon', c.oid, 'SELECT')
         OR has_any_column_privilege('authenticated', c.oid, 'SELECT'))
  ORDER BY 2;

  -- The default privileges themselves, which is what makes the function case
  -- recur. Advisory when the caller could not cancel it even if they wanted to.
  RETURN QUERY
  SELECT 'default_privilege'::TEXT,
         COALESCE(pg_get_userbyid(d.defaclrole), '?') || ' on functions',
         CASE WHEN pg_has_role(current_user, d.defaclrole, 'MEMBER')
              THEN 'blocking' ELSE 'advisory' END::TEXT,
         CASE WHEN pg_has_role(current_user, d.defaclrole, 'MEMBER')
           THEN 'ALTER DEFAULT PRIVILEGES still grants EXECUTE to anon, and you '
                || 'are a member of ' || pg_get_userbyid(d.defaclrole) || ' so you '
                || 'can cancel it. Run: SELECT enforce_anon_execute_posture();'
           ELSE 'ALTER DEFAULT PRIVILEGES grants EXECUTE to anon on functions '
                || 'created by ' || pg_get_userbyid(d.defaclrole) || '. ' || current_user
                || ' is not a member of that role and cannot cancel it; on Supabase '
                || 'nothing you can run from the SQL editor can. Advisory only. It '
                || 'affects functions created BY that role, and BluePLM''s are created '
                || 'by ' || current_user || ', which is swept at the end of every file.'
         END
  FROM pg_default_acl d
  JOIN pg_namespace n ON n.oid = d.defaclnamespace
  WHERE n.nspname = 'public'
    AND d.defaclobjtype = 'f'
    AND EXISTS (
      SELECT 1 FROM aclexplode(d.defaclacl) x
      WHERE x.grantee = 'anon'::regrole AND x.privilege_type = 'EXECUTE'
    );
END;
$$;

REVOKE ALL ON FUNCTION check_anon_reach() FROM PUBLIC, anon, authenticated;

-- Membership tests that are wrong when the caller has no organization yet.
--
--   IF p_org_id NOT IN (SELECT org_id FROM users WHERE id = auth.uid()) THEN
--     RAISE EXCEPTION 'Not authorized for this organization';
--   END IF;
--
-- reads as a gate and is not one. A newly created account has users.org_id
-- NULL, so the subquery yields a single NULL row, `x NOT IN (NULL)` is NULL
-- rather than true, the IF is not taken, and the body runs against whatever
-- organization the caller named. Nine of these shipped. Four happened to be
-- saved by a conjoined `AND NOT is_org_admin()`; five were not, and from an
-- account with no organization the reviewer read another tenant's Odoo
-- configuration and integration status, read its item-designation assignments,
-- and overwrote and then deleted a row in its item_images.
--
-- check_org_gates() cannot catch this. It probes as the caller of
-- verify-schema.sql, which is postgres in the SQL editor, where auth.uid() is
-- NULL; `NULL NOT IN (...)` is also NULL, but require_org_member() raises
-- 'Not authenticated' first, so the probe sees a refusal and scores the function
-- gated. The one input that triggers the bug is the one input the probe cannot
-- present. So this is a source check, deliberately - it is looking for a shape
-- that must not exist, not for a behaviour.
--
-- The shape is banned outright rather than only where it is currently
-- exploitable. A gate whose correctness depends on a second condition someone
-- may later remove is not a gate. Use is_org_member() or require_org_member().
--
-- ONE SHAPE, NOT ONE SPELLING
--
-- The first version of this check was a literal regex for
-- `not in (select org_id from users`, run over plpgsql functions only. All nine
-- shipped sites happened to be spelled that way, so it found all nine and the
-- release said the shape was "banned outright". It was not: an alias, a
-- schema-qualified `public.users`, the `<> ALL (...)` form, `NOT (x IN (...))`,
-- `NOT (x = ANY (...))`, and anything written in LANGUAGE sql all walked past
-- it. Each of those is the same NULL, and each would have shipped.
--
-- What is still not covered, stated rather than implied: a membership subquery
-- against a table other than `users`, a comparison against a variable loaded
-- from users in an earlier statement (`SELECT org_id INTO v FROM users ...;
-- IF p_org_id <> v THEN`), and anything built with EXECUTE. The first two are
-- worth knowing about; check_org_gates() is what stands behind them, and the
-- convention that closes them is to call is_org_member() and never hand-write
-- the test at all.
CREATE OR REPLACE FUNCTION check_null_unsafe_org_gates()
RETURNS TABLE (signature TEXT, detail TEXT)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  -- Shared tail: the subquery being compared against, in any spelling.
  --   optional alias or schema on the column, optional public. on the table
  c_subq CONSTANT TEXT :=
    'select +(distinct +)?(\w+ *\. *)?org_id +from +(public *\. *)?users\M';
  r RECORD;
  v_src TEXT;
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure::TEXT AS sig, p.prosrc
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      -- Procedures and LANGUAGE sql functions too. is_org_member() is LANGUAGE
      -- sql, so "the helpers are sql, only the RPCs are plpgsql" was never true
      -- and a gate written the wrong way in a sql function was invisible.
      -- Aggregates and window functions are excluded because
      -- pg_get_functiondef() refuses them, not because they are trusted.
      AND p.prokind IN ('f', 'p')
      AND p.prolang IN (SELECT oid FROM pg_language WHERE lanname IN ('plpgsql', 'sql'))
      -- The checkers describe the pattern in order to look for it.
      AND p.proname NOT IN ('check_null_unsafe_org_gates', 'strip_sql_noise')
    ORDER BY 1
  LOOP
    -- prosrc, the body alone, not pg_get_functiondef. Comments and string
    -- literals removed, so a note about the pattern does not read as the
    -- pattern, and whitespace flattened so line breaks inside the expression do
    -- not hide it.
    v_src := lower(regexp_replace(strip_sql_noise(r.prosrc), '\s+', ' ', 'g'));

    IF v_src ~ ('not +in *\( *' || c_subq) THEN
      signature := r.sig;
      detail := 'uses NOT IN (SELECT org_id FROM users ...), which evaluates to '
             || 'NULL - not true - when the caller''s users.org_id is NULL, so the '
             || 'refusal never fires for an account that has not joined an '
             || 'organization yet. Use require_org_member(p_org_id), or '
             || 'NOT is_org_member(p_org_id) where the function returns rather '
             || 'than raises.';
      RETURN NEXT;
    ELSIF v_src ~ ('(<>|!=) *(all *)?\( *' || c_subq) THEN
      signature := r.sig;
      detail := 'compares an organization id with (SELECT org_id FROM users ...) '
             || 'using <>, != or <> ALL, all of which are NULL when the caller''s '
             || 'users.org_id is NULL, so the refusal never fires. Use '
             || 'is_org_member() instead.';
      RETURN NEXT;
    ELSIF v_src ~ ('not *\( *[\w.]+ +in *\( *' || c_subq) THEN
      signature := r.sig;
      detail := 'uses NOT (x IN (SELECT org_id FROM users ...)). Moving the NOT '
             || 'outside the parentheses changes nothing: NOT NULL is still NULL '
             || 'when the caller''s users.org_id is NULL, so the refusal never '
             || 'fires. Use is_org_member() instead.';
      RETURN NEXT;
    ELSIF v_src ~ ('not +[\w.]+ *= *any *\( *(array *\( *)?' || c_subq) THEN
      signature := r.sig;
      detail := 'uses NOT x = ANY (SELECT org_id FROM users ...), which is NULL '
             || 'rather than true when the caller''s users.org_id is NULL, so the '
             || 'refusal never fires. Use is_org_member() instead.';
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION check_null_unsafe_org_gates() FROM PUBLIC, anon, authenticated;

-- Functions that check one argument and then act on another.
--
-- create_file_share_link took p_org_id and p_file_id, called
-- require_org_member(p_org_id) - which passed, because the caller really was a
-- member of the organization they named - and then inserted p_file_id without
-- ever asking which organization that file belonged to. Passing your own org id
-- with somebody else's file id minted a working share token for their file. The
-- argument that was checked was not the argument that selected the row.
--
-- Neither existing check could see it. check_org_gates() calls the function with
-- NULLs and looks for a refusal, and it got one, because require_org_member()
-- refuses an unauthenticated caller. check_anon_reach() only asks who may
-- execute, and the answer - authenticated members - was correct. The function
-- was certified by both while being wrong for the one caller that mattered.
--
-- Rule 1 below is narrow on purpose: it reports only the specific contradiction
-- of gating on p_org_id while never once using p_org_id to constrain a row. A
-- function that says `WHERE org_id = p_org_id` somewhere, or that derives the
-- organization from the entity through a require_..._access() helper, is doing
-- the binding and is left alone - including get_vault_files_delta(), whose
-- vault filter sits on a different line from its org filter but is still inside
-- the same query.
--
-- WHY THIS NO LONGER STARTS FROM p_org_id
--
-- The first version only considered functions that take a p_org_id, because
-- create_file_share_link took one. That filter was the finding restated as a
-- rule rather than the rule the finding was an instance of: a function that
-- gates on an *entity* - require_file_access(p_file_id) - and then acts on a
-- second id it never checks has exactly the same defect and no p_org_id
-- anywhere, so this check could not see it.
--
-- apply_workflow_transition was that function. It called
-- require_file_access(p_file_id), which is correct and sufficient for the file,
-- and then loaded p_transition_id with an existence test and nothing else. A
-- member of one organization applied another organization's classified
-- transition to her own file, and its workflow name, state name and transition
-- name are now in her workflow_history. It was in this release's manifest, and
-- the check written to stop this recurring could not look at it.
--
-- Dropping the p_org_id filter leaves seven security-definer functions in
-- public that take two or more row-selecting uuid ids. Six bind the second one;
-- one did not.
--
-- THE RULE, AND WHY IT IS A COUNT
--
-- Proving "argument B is constrained to the organization argument A
-- established" from source text is not something a regex can do - the binding
-- may be two statements away, through a record variable. A rule that demanded
-- proof would report functions that are correct, and a check that cannot be
-- satisfied is worse than no check: that was finding 1, a verifier withholding
-- the stamp for a condition the operator could not clear.
--
-- So the rule counts, and it errs towards passing. Every id the function looks
-- a row up by needs an organization check that is not already spoken for by a
-- different id. It cannot tell you *which* check covers which argument in the
-- general case, and it does not try; what it can tell you is that there are
-- more ids being reached through than there are checks left to cover them.
--
-- One subtraction in that arithmetic is load-bearing and was not there at
-- first. A resolver call is a binding, but it is a binding of the argument it
-- was handed. `require_file_access(p_file_id)` followed by a bare
-- `WHERE id = p_transition_id` has one binding and one unchecked id, which
-- balances on a naive count - and is exactly apply_workflow_transition. So a
-- resolver call is subtracted from the checks available before the comparison
-- is made. NC11 in the harness is that case, and it is the reason the harness
-- reintroduces each hole rather than trusting the rule to be right.
CREATE OR REPLACE FUNCTION row_selecting_id_args(p_oid OID)
RETURNS TEXT[]
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_agg(a.name ORDER BY a.ord), '{}'::TEXT[])
  FROM pg_proc p
  CROSS JOIN LATERAL unnest(p.proargnames) WITH ORDINALITY AS a(name, ord)
  WHERE p.oid = p_oid
    AND a.name ~ '_id$'
    -- IN and INOUT only. An OUT column called link_id is a result, not a way to
    -- reach into another tenant.
    AND (p.proargmodes IS NULL OR p.proargmodes[a.ord] IN ('i', 'b'))
    -- uuid only. Every primary key in this schema is a uuid, so a text
    -- argument called p_machine_id is a value being stored, not a row being
    -- selected - and treating it as one made checkout_file() a candidate for a
    -- rule that has nothing to say about it.
    AND 'uuid'::regtype = CASE
          WHEN p.proallargtypes IS NULL THEN p.proargtypes[a.ord - 1]
          ELSE p.proallargtypes[a.ord]
        END
    -- Who is acting, not which row is acted on.
    AND a.name NOT IN ('p_user_id', 'p_created_by', 'p_actor_id', 'p_updated_by');
$$;

REVOKE ALL ON FUNCTION row_selecting_id_args(OID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION check_unbound_entity_args()
RETURNS TABLE (signature TEXT, detail TEXT)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  -- One organization binding. require_\w+ covers require_org_member,
  -- require_file_access, require_vault_access, require_eco_access and
  -- require_same_org_user; the third alternative is a hand-written comparison
  -- on an org_id column, which is what the two workflow functions now use to
  -- tie their transition to the file's organization.
  -- The org_id alternatives allow a prefix and match either side of the
  -- comparison, because the binding is not always written as a column test.
  -- add_pending_license_assignment() resolves the licence's organization into
  -- v_license_org_id and compares that to the invitation's - which is a correct
  -- and complete binding, and which a pattern anchored on a bare `org_id =`
  -- could not see. It was reported, and it was right.
  c_binding CONSTANT TEXT :=
    '(require_\w+ *\(|is_org_member *\('
    '|[\w.]*org_id *(=|<>|!=)|(=|<>|!=) *[\w.]*org_id\M)';
  -- Something has to be gating, or this is check_org_gates()'s finding and not
  -- this one's.
  c_any_gate CONSTANT TEXT :=
    '(require_\w+ *\(|is_org_member *\(|is_org_admin *\()';
  r RECORD;
  v_src TEXT;
  v_org_others TEXT;
  v_args TEXT[];
  v_resolved TEXT[];
  v_looked_up TEXT[];
  v_sites INTEGER;
  v_consumed INTEGER;
BEGIN
  FOR r IN
    SELECT p.oid,
           p.oid::regprocedure::TEXT AS sig,
           p.proargnames,
           p.proargmodes,
           p.prosrc
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p')
      AND p.prosecdef
      AND p.prolang IN (SELECT oid FROM pg_language WHERE lanname IN ('plpgsql', 'sql'))
      AND p.proname <> 'check_unbound_entity_args'
    ORDER BY 1
  LOOP
    -- The body alone. pg_get_functiondef() prepends the CREATE line, and the
    -- CREATE line of a function called require_something_or_other contains
    -- `require_something_or_other(`, which is one of the patterns below - so a
    -- gate helper would have counted itself as a gate and any future one with
    -- two id arguments would have been waved through by its own name.
    v_src := lower(regexp_replace(strip_sql_noise(r.prosrc), '\s+', ' ', 'g'));

    -- ---------------------------------------------------------------------
    -- Rule 1, unchanged: gates on p_org_id and never uses it to select a row.
    --
    -- This is create_file_share_link's exact defect and it is worth naming
    -- separately, because the remedy is specific: the argument that was checked
    -- was not the argument that chose the row.
    -- ---------------------------------------------------------------------
    -- THE OTHER IDS ARE THE ONES row_selecting_id_args() RECOGNISES
    --
    -- This used to take every argument whose name ends in _id, of any type,
    -- which is the mistake rule 2 already knew not to make and says so in
    -- row_selecting_id_args(): every primary key in this schema is a uuid, so a
    -- text argument called p_client_id is a Google OAuth client id being
    -- stored, not a row being reached into. update_google_drive_settings was
    -- reported for "acting on" p_client_id and p_inspection_template_folder_id,
    -- and update_extension_config for a p_extension_id that is text and is half
    -- of a composite key whose other half is the gated p_org_id. Neither is a
    -- way into another tenant, and a check that reports them is a check the
    -- operator learns to scroll past.
    --
    -- Both were invisible before only because they hand-wrote their membership
    -- test as `... AND org_id = p_org_id`, which this rule reads as p_org_id
    -- constraining a row. Converting them to require_org_member() removed that
    -- accidental exemption and exposed the real defect, which is here.
    IF 'p_org_id' = ANY(COALESCE(r.proargnames, '{}')) THEN
      SELECT string_agg(a, ', ') INTO v_org_others
      FROM unnest(row_selecting_id_args(r.oid)) AS a
      WHERE a <> 'p_org_id';

      IF v_org_others IS NOT NULL
         AND v_src ~ '(require_org_member|is_org_member) *\( *p_org_id'
         AND v_src !~ 'org_id *= *p_org_id'
         AND v_src !~ 'require_\w+_access *\(' THEN
        signature := r.sig;
        detail := 'gates on p_org_id but never uses it to constrain a row, while '
               || v_org_others || ' select(s) the row it acts on. A caller who is a '
               || 'genuine member of the organization they name can therefore pass '
               || 'another tenant''s id and be served. Either compare the entity''s '
               || 'own org_id to p_org_id, or derive the organization from the '
               || 'entity with a require_..._access() helper and ignore p_org_id.';
        RETURN NEXT;
        CONTINUE;
      END IF;
    END IF;

    -- ---------------------------------------------------------------------
    -- Rule 2: an id selects a row and no organization check is left to cover it.
    --
    -- Three quantities, and the arithmetic between them is the whole rule.
    --
    --   resolved   ids handed straight to a resolver - require_file_access(
    --              p_file_id), is_org_member(p_org_id). The call establishes
    --              the organization for that id, so it needs nothing else.
    --   direct     ids the function looks a row up by itself, `= p_x`, that
    --              are not resolved and are not p_org_id. Each of these needs
    --              an organization test somewhere.
    --   free       organization bindings not already spoken for. A resolver
    --              call is itself a binding, but it is a binding *of the id it
    --              was given*, so it cannot also cover a different one.
    --
    -- That last subtraction is the part a plain count got wrong, and NC11
    -- caught it: a function calling require_file_access(p_file_id) and then
    -- loading p_transition_id by id alone has one binding and one unbound id,
    -- which balances - and is precisely apply_workflow_transition's defect.
    -- The binding belongs to the file. Nothing is looking at the transition.
    -- ---------------------------------------------------------------------
    v_args := row_selecting_id_args(r.oid);
    CONTINUE WHEN COALESCE(array_length(v_args, 1), 0) < 2;

    -- Ungated altogether is a different finding with a different owner.
    CONTINUE WHEN v_src !~ c_any_gate;

    v_resolved := ARRAY(
      SELECT a FROM unnest(v_args) AS a
      WHERE v_src ~ ('(require_\w+|is_org_member) *\( *' || a || '\M')
    );

    -- p_org_id is excluded because it is not a row being reached into - it is
    -- the organization itself, and rule 1 above is what has anything to say
    -- about a function that names one and never uses it.
    v_looked_up := ARRAY(
      SELECT a FROM unnest(v_args) AS a
      WHERE a <> 'p_org_id'
        AND NOT (a = ANY (v_resolved))
        AND v_src ~ ('= *' || a || '\M')
    );
    CONTINUE WHEN COALESCE(array_length(v_looked_up, 1), 0) = 0;

    SELECT count(*) INTO v_sites FROM regexp_matches(v_src, c_binding, 'g');
    SELECT count(*) INTO v_consumed
    FROM regexp_matches(v_src, '(require_\w+|is_org_member) *\( *p_\w*_id\M', 'g');

    CONTINUE WHEN (v_sites - v_consumed) >= array_length(v_looked_up, 1);

    signature := r.sig;
    detail := 'looks a row up by ' || array_to_string(v_looked_up, ', ')
           || ', and every organization check it performs is already accounted '
           || 'for by another argument (' || v_sites || ' check(s), ' || v_consumed
           || ' of them bound to an id that was passed in). So that id is taken '
           || 'from the caller and never tested against the organization the '
           || 'others established. That is how a member of one tenant applied '
           || 'another tenant''s workflow transition to her own file. Resolve it '
           || 'against the organization the gate returned - a require_..._access() '
           || 'helper, or an org_id comparison in the query that loads it.';
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION check_unbound_entity_args() FROM PUBLIC, anon, authenticated;

-- The other half of the manifest: what the data must no longer contain.
--
-- See the note above schema_remediation_log. These are the same questions the
-- remediations answer, asked again afterwards by something that did not run
-- them, so "the remediation ran" and "the residue is gone" stay two separate
-- statements. Anything reported here withholds the stamp, which is what makes
-- forgetting a remediation impossible rather than merely discouraged.
--
-- Guarded by to_regclass throughout: a core-only install has none of these
-- tables and must not fail for the lack of them.
--
-- WHAT COUNTS AS RESIDUE, AND WHAT DELIBERATELY DOES NOT
--
-- An active cross-tenant share link does, because it is a live credential. A
-- deactivated one does not: that is a remediated row kept for the audit, and a
-- check that kept refusing after the remedy had run would be the v90 defect
-- again - a condition the operator cannot clear.
--
-- A workflow_history row whose workflow, transition or state id belongs to
-- another organization does, because the names copied alongside those ids are
-- readable by the wrong tenant for as long as the row says what it says. A row
-- whose ids are NULL does not, and cannot be judged: the foreign keys are ON
-- DELETE SET NULL, so a NULL there is ordinary. This is stated rather than
-- hidden - a history row that names a foreign workflow only in its text
-- columns, with no ids, is outside what this can see.
CREATE OR REPLACE FUNCTION check_release_residue()
RETURNS TABLE (residue TEXT, identity TEXT, detail TEXT)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r RECORD;
BEGIN
  -- ---------------------------------------------------------------------
  -- Share links handing out a file in an organization somebody involved is not
  -- part of.
  --
  -- Three different rows match and all three are live cross-tenant credentials:
  -- one minted through the hole; one minted in good faith for a file that later
  -- moved organizations; and one whose link and file agree because both were
  -- rewritten together over the UPDATE policy, which carried no WITH CHECK
  -- until this release. The third is the one an org_id-only match cannot see,
  -- so the creator's membership is a term of the query here and not only of the
  -- prose - it must be, or this reports clean over a row
  -- remediate_cross_tenant_share_links() is about to deactivate, and the two
  -- halves of the release stop agreeing.
  --
  -- The detail says which shape it looks like, so an operator restoring a link
  -- they judge legitimate can tell them apart. None is left active, because
  -- under this release validate_share_link() resolves the organization from the
  -- file, so all three hand out a file to somebody with no claim on it.
  -- ---------------------------------------------------------------------
  IF to_regclass('public.file_share_links') IS NOT NULL
     AND to_regclass('public.files') IS NOT NULL THEN
    FOR r IN
      SELECT l.id, l.token, l.org_id AS link_org, f.org_id AS file_org,
             l.created_by, l.created_at, cu.org_id AS creator_org
      FROM file_share_links l
      JOIN files f ON f.id = l.file_id
      LEFT JOIN users cu ON cu.id = l.created_by
      WHERE (l.org_id IS DISTINCT FROM f.org_id
             OR cu.org_id IS DISTINCT FROM f.org_id)
        AND COALESCE(l.is_active, false)
      ORDER BY l.created_at
    LOOP
      residue := 'cross_tenant_share_link';
      -- The token's first eight characters as well as the row id, because the
      -- way an operator meets this is somebody telling them a link stopped
      -- working, and what they have is the URL. Eight characters of a
      -- 128-bit token identify the row without being the credential, and the
      -- credential is about to be deactivated in any case.
      identity := 'file_share_links.id = ' || r.id
               || ' (token ' || left(r.token, 8) || '...)';
      detail := 'is active and grants access to a file in organization '
             || r.file_org || ', while the link itself was minted for '
             || COALESCE(r.link_org::TEXT, 'no organization') || '. Created by '
             || r.created_by || ' on ' || r.created_at || ', who is '
             || CASE
                  WHEN r.link_org IS NOT DISTINCT FROM r.file_org
                    THEN 'NOT a member of the file''s organization even though '
                         || 'the link names it correctly - the shape an UPDATE '
                         || 'with no WITH CHECK produced by rewriting file_id '
                         || 'and org_id together, or a creator who has since '
                         || 'left the organization'
                  WHEN r.creator_org IS NOT DISTINCT FROM r.file_org
                    THEN 'a member of the file''s organization, so this is most '
                         || 'likely a file that moved after the link was minted '
                         || 'in good faith'
                  ELSE 'NOT a member of the file''s organization, which is the '
                       || 'shape create_file_share_link produced before this '
                       || 'release resolved the organization from the file' END
             || '. Deactivate it: SELECT remediate_cross_tenant_share_links();';
      RETURN NEXT;
    END LOOP;
  END IF;

  -- ---------------------------------------------------------------------
  -- Workflow history naming another organization's workflow.
  --
  -- Asked through the foreign keys rather than through the names. A name join
  -- would report every history row of two tenants who both called a workflow
  -- 'Standard Release', which is not a finding and would make the stamp
  -- unobtainable for a reason nobody could act on.
  -- ---------------------------------------------------------------------
  IF to_regclass('public.workflow_history') IS NOT NULL
     AND to_regclass('public.workflow_templates') IS NOT NULL THEN
    FOR r IN
      SELECT h.id, h.org_id, h.file_id, h.workflow_name, h.performed_at
      FROM workflow_history h
      WHERE EXISTS (SELECT 1 FROM workflow_templates t
                     WHERE t.id = h.workflow_id AND t.org_id <> h.org_id)
         OR EXISTS (SELECT 1 FROM workflow_transitions tr
                     JOIN workflow_templates t2 ON t2.id = tr.workflow_id
                    WHERE tr.id = h.transition_id AND t2.org_id <> h.org_id)
         OR EXISTS (SELECT 1 FROM workflow_states s
                     JOIN workflow_templates t3 ON t3.id = s.workflow_id
                    WHERE s.id IN (h.from_state_id, h.to_state_id)
                      AND t3.org_id <> h.org_id)
      ORDER BY h.performed_at
    LOOP
      residue := 'cross_tenant_workflow_history';
      identity := 'workflow_history.id = ' || r.id;
      detail := 'is filed under organization ' || r.org_id || ' and names a '
             || 'workflow, transition or state belonging to another one. The '
             || 'names copied into it are readable by every member of '
             || r.org_id || ' through their own history. Redact it: '
             || 'SELECT remediate_cross_tenant_workflow_history();';
      RETURN NEXT;
    END LOOP;
  END IF;

  -- ---------------------------------------------------------------------
  -- A file left sitting in another organization's workflow state.
  --
  -- The same attack rewrote this row. It discloses no names by itself, and it
  -- decides which transitions the file offers, so leaving it is leaving the
  -- file driven by a workflow its organization does not own.
  -- ---------------------------------------------------------------------
  IF to_regclass('public.file_workflow_assignments') IS NOT NULL
     AND to_regclass('public.workflow_templates') IS NOT NULL
     AND to_regclass('public.files') IS NOT NULL THEN
    FOR r IN
      SELECT a.file_id, f.org_id AS file_org, wt.org_id AS workflow_org, wt.id AS workflow_id
      FROM file_workflow_assignments a
      JOIN files f ON f.id = a.file_id
      JOIN workflow_templates wt ON wt.id = a.workflow_id
      WHERE wt.org_id <> f.org_id
      ORDER BY a.file_id
    LOOP
      residue := 'cross_tenant_workflow_assignment';
      identity := 'file_workflow_assignments.file_id = ' || r.file_id;
      detail := 'assigns a file in organization ' || r.file_org
             || ' to workflow ' || r.workflow_id || ', which belongs to '
             || r.workflow_org || '. Clear it: '
             || 'SELECT remediate_cross_tenant_workflow_history();';
      RETURN NEXT;
    END LOOP;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION check_release_residue() FROM PUBLIC, anon, authenticated;

-- FUNCTIONS WHOSE ENTIRE DEFENCE IS THE ABSENCE OF AN EXECUTE GRANT
--
-- Some SECURITY DEFINER functions cannot be gated by an argument, because they
-- take no organization to check the caller against. The two extension-log
-- sweeps delete by age across every tenant at once; the three seeders run from
-- the on_organization_created trigger, before the new organization has any
-- members to be one of. For all five, not being callable is the whole of the
-- protection, and check_org_gates() cannot express that: with no p_org_id there
-- is no foreign id to substitute and no refusal to require.
--
-- So the ACL becomes the assertion. This list is small and hand-maintained on
-- purpose - it is a statement that somebody looked at each of these and
-- concluded the endpoint should not exist for a PostgREST caller, not a
-- heuristic. Adding a function here is cheap; the cost of leaving one out is
-- what release 95 nearly shipped.
--
-- Why this is separate from check_org_gates() rather than folded into it: that
-- function decides a verdict for every SECURITY DEFINER function in the schema,
-- and changing how it reaches one changes what the stamp means everywhere. This
-- asks a single closed question about five named functions and can only ever
-- add a problem for one of them.
CREATE OR REPLACE FUNCTION withdrawn_execute_manifest()
RETURNS TABLE (module TEXT, signature TEXT)
LANGUAGE sql IMMUTABLE AS $$
  VALUES
    ('core',          'create_default_job_titles(uuid,uuid)'),
    ('core',          'create_default_permission_teams(uuid,uuid)'),
    ('60-customers',  'seed_customer_categories(uuid)'),
    ('50-extensions', 'cleanup_extension_http_logs(integer)'),
    ('50-extensions', 'cleanup_extension_secret_access_logs(integer)')
$$;

REVOKE ALL ON FUNCTION withdrawn_execute_manifest() FROM PUBLIC, anon, authenticated;

-- 'reachable' is the only status that withholds the stamp. 'absent' is a module
-- that is not installed - optional modules are the normal case here, and a
-- function that does not exist cannot be called. 'withdrawn' is the healthy
-- state and carries the ACL that proves it, so a reader can see what is doing
-- the work rather than taking the word 'withdrawn' on trust.
CREATE OR REPLACE FUNCTION check_withdrawn_execute()
RETURNS TABLE (module TEXT, signature TEXT, status TEXT, detail TEXT)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r        RECORD;
  v_oid    OID;
  v_roles  TEXT[];
  v_acl    TEXT;
BEGIN
  FOR r IN SELECT m.module, m.signature FROM withdrawn_execute_manifest() m LOOP
    module    := r.module;
    signature := r.signature;
    v_oid     := to_regprocedure(r.signature);

    IF v_oid IS NULL THEN
      status := 'absent';
      detail := 'not installed on this database, so there is no endpoint to withdraw. '
             || 'If the module owning it is installed, this row is a missing object and '
             || 'check_schema_release() reports it as such.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- The casts are load-bearing. `text[] || 'anon'` resolves to array_cat, so
    -- the untyped literal is parsed as an array and the whole check dies with
    -- 'malformed array literal: "authenticated"'. It only reaches that line
    -- when a function IS reachable, so a clean database never executed it and
    -- the bug read as a pass; NC19 is what found it.
    v_roles := ARRAY[]::TEXT[];
    IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      v_roles := v_roles || 'anon'::TEXT;
    END IF;
    IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      v_roles := v_roles || 'authenticated'::TEXT;
    END IF;

    SELECT COALESCE(p.proacl::TEXT, '(default: owner and PUBLIC)')
      INTO v_acl
    FROM pg_proc p WHERE p.oid = v_oid;

    IF cardinality(v_roles) > 0 THEN
      status := 'reachable';
      detail := array_to_string(v_roles, ' and ') || ' may EXECUTE this, so it is a live '
             || 'PostgREST endpoint. It takes no organization argument and checks no '
             || 'membership, so whoever calls it acts on every tenant at once. Withdraw it: '
             || 'REVOKE ALL ON FUNCTION ' || r.signature || ' FROM PUBLIC, anon, authenticated; '
             || 'ACL: ' || v_acl;
    ELSE
      status := 'withdrawn';
      detail := 'no PostgREST role may execute it. ACL: ' || v_acl;
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION check_withdrawn_execute() FROM PUBLIC, anon, authenticated;

-- The only writer of schema_version. Stamps the release number if and only if
-- every requirement of every installed module is satisfied; on failure it
-- leaves the recorded version exactly as it was and reports what is wrong,
-- because a half-applied database is still whatever it was before, not zero.
--
-- "Every requirement" now includes the two security checks. They used to sit in
-- verify-schema.sql as RAISE NOTICE beside a stamp that consulted only the
-- manifest, so a database could be told it was reachable by anon and stamped
-- verified in the same run - which is what happened, and why the exposure
-- survived a passing verification. A check that cannot withhold the stamp is
-- commentary.
CREATE OR REPLACE FUNCTION verify_and_stamp_schema()
RETURNS JSON
LANGUAGE plpgsql AS $$
DECLARE
  v_problems JSON;
  v_count INTEGER;
  v_updated INTEGER;
BEGIN
  SELECT COALESCE(json_agg(p ORDER BY p->>'module', p->>'object'), '[]'::json),
         COUNT(*)
    INTO v_problems, v_count
  FROM (
    SELECT json_build_object(
             'module', module, 'object', identity, 'status', status, 'detail', detail
           ) AS p
    FROM check_schema_release()
    WHERE status IN ('missing', 'stale', 'extra')

    UNION ALL
    -- 'unverifiable' blocks alongside 'ungated'. This clause used to name
    -- 'ungated' alone, which meant a reachable function the probe could not
    -- judge either way was treated exactly like one it had certified. A check
    -- that cannot reach a verdict has to say so loudly or it is not a check;
    -- see the ELSE branch of check_org_gates() for what separates the two.
    SELECT json_build_object(
             'module', 'security', 'object', signature, 'status', status,
             'detail', detail
           )
    FROM check_org_gates()
    WHERE org_gate_status_blocks(status)

    UNION ALL
    SELECT json_build_object(
             'module', 'security', 'object', identity, 'status', 'anon-reachable',
             'detail', detail
           )
    FROM check_anon_reach()
    -- Advisory rows are reported by tools/verify-schema.sql and do not withhold
    -- the stamp. Advisory means one thing only: the caller is not permitted to
    -- change it - not a member of the role that granted it, not the owner of
    -- the object, not a superuser. On Supabase that is supabase_admin: the
    -- default-privilege row it holds, and anything an extension installed into
    -- public under its ownership. Real, printed in full, and impossible for the
    -- operator to act on. Treating it as fatal made a correctly installed
    -- database unstampable for ever, which is worse than saying so out loud.
    WHERE severity = 'blocking'

    UNION ALL
    SELECT json_build_object(
             'module', 'security', 'object', signature, 'status', 'null-unsafe-gate',
             'detail', detail
           )
    FROM check_null_unsafe_org_gates()

    UNION ALL
    SELECT json_build_object(
             'module', 'security', 'object', signature, 'status', 'unbound-entity-arg',
             'detail', detail
           )
    FROM check_unbound_entity_args()

    -- The class check_org_gates() structurally cannot judge: a SECURITY DEFINER
    -- function with no organization argument, whose only protection is that no
    -- PostgREST role may execute it. See withdrawn_execute_manifest().
    UNION ALL
    SELECT json_build_object(
             'module', 'security', 'object', signature, 'status', 'execute-not-withdrawn',
             'detail', detail
           )
    FROM check_withdrawn_execute()
    WHERE status = 'reachable'

    -- What a closed hole already produced, which closing it does not undo.
    -- This is the half the manifest did not have: v92 shipped a correct fix
    -- for cross-tenant share links and stamped a database on which one was
    -- still live. See check_release_residue().
    UNION ALL
    SELECT json_build_object(
             'module', 'security', 'object', identity, 'status', residue,
             'detail', detail
           )
    FROM check_release_residue()
  ) s;

  IF v_count > 0 THEN
    RETURN json_build_object(
      'stamped', false,
      'version', (SELECT version FROM schema_version WHERE id = 1),
      'target_version', schema_release_version(),
      'problems', v_problems
    );
  END IF;

  UPDATE schema_version
  SET version = schema_release_version(),
      description = schema_release_description(),
      applied_at = NOW(),
      applied_by = 'verify-schema'
  WHERE id = 1;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- schema_version has RLS and only service_role may UPDATE it, so for anyone
  -- else the statement above matches no row and succeeds. Without this check the
  -- function returned {"stamped": true} with the recorded version untouched -
  -- reported as verified twice over, by a caller who could not write it and by a
  -- script that believed the caller. A write that did not happen is a failure,
  -- and saying so is the whole point of this function existing.
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'Could not write schema_version: % is not permitted to update it. Run this from the Supabase SQL editor, which connects as postgres.', current_user
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN json_build_object(
    'stamped', true,
    'version', schema_release_version(),
    'target_version', schema_release_version(),
    'problems', '[]'::json
  );
END;
$$;

-- Stamping is an administrative act, not an endpoint: it is reached by pasting
-- tools/verify-schema.sql into the Supabase SQL editor, which connects as
-- postgres. Naming the roles matters - REVOKE ... FROM PUBLIC on its own leaves
-- the explicit anon and authenticated grants that Supabase's ALTER DEFAULT
-- PRIVILEGES puts on every new function, which is how anon came to be able to
-- call this at all.
REVOKE ALL ON FUNCTION verify_and_stamp_schema() FROM PUBLIC, anon, authenticated;

-- What a schema file calls as its last act: ask to be verified, and report the
-- answer in one line. core.sql and every module end with this, so the version is
-- recorded by whichever file the operator happens to run last and there is no
-- separate step to forget.
--
-- WHY EVERY FILE MAY ASK, WHEN NO FILE MAY STAMP
--
-- Until 89 each file stamped the head version unconditionally at its end, and
-- that had to stop: the number is one global value while the files are
-- per-module, so `SELECT update_schema_version(88)` at the bottom of
-- 30-supply-chain.sql was a claim about seven files that module cannot see. It
-- recorded 88 over a database missing module 10's v87 work, and the app compared
-- 88 to its own 88 and showed no warning.
--
-- Delegating to verify_and_stamp_schema() removes the defect rather than the
-- convenience. The answer is computed from the whole release manifest and every
-- security check, so it does not depend on which file asked, and a file that
-- asks too early is simply told no. What was wrong was never that a schema file
-- did the asking; it was that being run counted as an answer.
--
-- This is deliberately quiet about failure - one line, no object list. During a
-- normal install every file but the last one gets a no, and seven paragraphs of
-- missing objects scrolling past on a correct install is how an operator learns
-- to ignore the output. tools/verify-schema.sql is the detailed report, and it
-- ends with an error rather than a notice.
--
-- It cannot raise, and that is load-bearing rather than defensive. The Supabase
-- SQL editor wraps a run in a single transaction, so an exception thrown here
-- would roll back the file that had just been applied successfully: an unstamped
-- install is a warning, a rolled-back one is an outage. verify_and_stamp_schema()
-- does raise, by design, when the caller may not write schema_version - which is
-- every role but two.
CREATE OR REPLACE FUNCTION try_stamp_schema()
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_result JSON;
  v_total INTEGER;
BEGIN
  BEGIN
    v_result := verify_and_stamp_schema();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Schema version not recorded: %', SQLERRM;
    RAISE WARNING 'The recorded version is unchanged. Run supabase/tools/verify-schema.sql from the Supabase SQL editor, which connects as postgres.';
    RETURN;
  END;

  IF (v_result->>'stamped')::BOOLEAN THEN
    RAISE NOTICE 'Schema verified and stamped at version %', v_result->>'version';
    RETURN;
  END IF;

  v_total := json_array_length(v_result->'problems');

  RAISE NOTICE 'Schema version not stamped: % outstanding item(s). Recorded version stays at %, this release is %.',
    v_total, v_result->>'version', v_result->>'target_version';
  RAISE NOTICE 'Expected until every file of this release has been applied - the last one records the version. supabase/tools/verify-schema.sql names each outstanding item.';
END;
$$;

REVOKE ALL ON FUNCTION try_stamp_schema() FROM PUBLIC, anon, authenticated;

-- Superseded by verify_and_stamp_schema(). Kept as a no-op so that an old copy
-- of a module file - which calls this at the end - neither fails halfway
-- through nor silently reinstates the false stamp it was written to make.
CREATE OR REPLACE FUNCTION update_schema_version(
  new_version INTEGER,
  new_description TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  RAISE WARNING 'update_schema_version() no longer records anything. Run supabase/tools/verify-schema.sql to verify and stamp the database.';
END;
$$ LANGUAGE plpgsql;

-- RLS: Everyone can read schema version
ALTER TABLE schema_version ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read schema version" ON schema_version;
CREATE POLICY "Anyone can read schema version"
  ON schema_version FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Service role can update schema version" ON schema_version;
CREATE POLICY "Service role can update schema version"
  ON schema_version FOR UPDATE
  USING (auth.role() = 'service_role');

-- ===========================================
-- CORE ENUMS
-- ===========================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('admin', 'engineer', 'viewer');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'permission_action') THEN
    CREATE TYPE permission_action AS ENUM ('view', 'create', 'edit', 'delete', 'admin');
  END IF;
END $$;

-- ===========================================
-- PERMISSION CHECK FUNCTIONS (Stubs)
-- ===========================================
-- Created early so RLS policies can reference them.
-- Replaced with full implementations after teams table.

CREATE OR REPLACE FUNCTION is_org_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
AS 'SELECT false';

CREATE OR REPLACE FUNCTION is_org_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
AS 'SELECT false';

CREATE OR REPLACE FUNCTION user_has_team_permission(
  p_resource TEXT,
  p_action permission_action,
  p_vault_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
AS 'SELECT false';

GRANT EXECUTE ON FUNCTION is_org_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION is_org_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION user_has_team_permission(TEXT, permission_action, UUID) TO authenticated;

-- ===========================================
-- ORGANIZATIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  email_domains TEXT[] NOT NULL DEFAULT '{}',
  settings JSONB DEFAULT '{
    "require_checkout": true,
    "auto_increment_part_numbers": true,
    "part_number_prefix": "BR-",
    "part_number_digits": 5,
    "allowed_extensions": [],
    "require_description": false,
    "require_approval_for_release": true,
    "max_file_size_mb": 500,
    "column_defaults": [],
    "enforce_email_domain": false,
    "allow_file_level_revision_for_models": false
  }'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Company branding
  logo_url TEXT,
  logo_storage_path TEXT,
  
  -- Company address
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'USA',
  
  -- Company contact
  phone TEXT,
  website TEXT,
  contact_email TEXT,
  
  -- Module configuration defaults
  module_defaults JSONB DEFAULT NULL,
  -- Timestamp when module_defaults was force-pushed to all users
  module_defaults_forced_at TIMESTAMPTZ DEFAULT NULL,
  
  -- Timestamp when column_defaults was force-pushed to all users
  column_defaults_forced_at TIMESTAMPTZ DEFAULT NULL,
  
  -- Auth provider settings
  auth_providers JSONB DEFAULT '{
    "users": { "google": true, "email": true, "phone": true },
    "suppliers": { "google": true, "email": true, "phone": true }
  }'::jsonb,
  
  -- Default team for org code signups
  default_new_user_team_id UUID
);

-- Migration: Add columns for existing tables
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN logo_url TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN logo_storage_path TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN address_line1 TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN address_line2 TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN city TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN state TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN postal_code TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN country TEXT DEFAULT 'USA'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN phone TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN website TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN contact_email TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN module_defaults JSONB DEFAULT NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN module_defaults_forced_at TIMESTAMPTZ DEFAULT NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN column_defaults_forced_at TIMESTAMPTZ DEFAULT NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN auth_providers JSONB DEFAULT '{"users": {"google": true, "email": true, "phone": true}, "suppliers": {"google": true, "email": true, "phone": true}}'::jsonb; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN default_new_user_team_id UUID; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_organizations_email_domains ON organizations USING GIN (email_domains);

-- ===========================================
-- USERS
-- ===========================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  custom_avatar_url TEXT,
  job_title TEXT,
  org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  role user_role NOT NULL DEFAULT 'engineer',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_sign_in TIMESTAMPTZ,
  last_online TIMESTAMPTZ
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'job_title') THEN
    ALTER TABLE users ADD COLUMN job_title TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'last_online') THEN
    ALTER TABLE users ADD COLUMN last_online TIMESTAMPTZ;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'custom_avatar_url') THEN
    ALTER TABLE users ADD COLUMN custom_avatar_url TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'column_defaults') THEN
    ALTER TABLE users ADD COLUMN column_defaults JSONB DEFAULT NULL;
  END IF;
END $$;

-- Ensure role column has NOT NULL (set default for any existing NULLs first)
UPDATE users SET role = 'engineer' WHERE role IS NULL;
DO $$ BEGIN
  ALTER TABLE users ALTER COLUMN role SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ===========================================
-- BLOCKED USERS
-- ===========================================

CREATE TABLE IF NOT EXISTS blocked_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  blocked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  blocked_at TIMESTAMPTZ DEFAULT NOW(),
  reason TEXT,
  UNIQUE(org_id, email)
);

CREATE INDEX IF NOT EXISTS idx_blocked_users_org_id ON blocked_users(org_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_email ON blocked_users(email);

ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view blocked users" ON blocked_users;
CREATE POLICY "Admins can view blocked users"
  ON blocked_users FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can manage blocked users" ON blocked_users;
CREATE POLICY "Admins can manage blocked users"
  ON blocked_users FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- ===========================================
-- TEAMS
-- ===========================================

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  icon TEXT NOT NULL DEFAULT 'Users',
  parent_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  is_default BOOLEAN DEFAULT false,
  is_system BOOLEAN DEFAULT false,
  module_defaults JSONB DEFAULT NULL,
  
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_teams_org_id ON teams(org_id);
CREATE INDEX IF NOT EXISTS idx_teams_parent ON teams(parent_team_id);

DO $$ BEGIN
  ALTER TABLE teams ADD COLUMN module_defaults JSONB DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Ensure color and icon columns have NOT NULL (set defaults for any existing NULLs first)
UPDATE teams SET color = '#3b82f6' WHERE color IS NULL;
UPDATE teams SET icon = 'Users' WHERE icon IS NULL;
DO $$ BEGIN
  ALTER TABLE teams ALTER COLUMN color SET NOT NULL;
  ALTER TABLE teams ALTER COLUMN icon SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ===========================================
-- TEAM MEMBERS
-- ===========================================

CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_team_admin BOOLEAN DEFAULT false,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  added_by UUID REFERENCES users(id),
  
  UNIQUE(team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);

-- ===========================================
-- TEAM REVIEWERS
-- ===========================================

CREATE TABLE IF NOT EXISTS team_reviewers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  reviewer_type TEXT NOT NULL CHECK (reviewer_type IN ('user', 'workflow_role')),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  workflow_role_id UUID,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  added_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_team_reviewers_team_id ON team_reviewers(team_id);

-- ===========================================
-- TEAM PERMISSIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS team_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  vault_id UUID, -- Will reference vaults when source-files module is installed
  actions permission_action[] DEFAULT '{}',
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  granted_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_team_permissions_team_id ON team_permissions(team_id);
CREATE INDEX IF NOT EXISTS idx_team_permissions_resource ON team_permissions(resource);

-- ===========================================
-- PERMISSION PRESETS
-- ===========================================

CREATE TABLE IF NOT EXISTS permission_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6366f1',
  icon TEXT DEFAULT 'Shield',
  permissions JSONB DEFAULT '{}',
  is_system BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_permission_presets_org_id ON permission_presets(org_id);

-- ===========================================
-- USER PERMISSIONS (Individual overrides)
-- ===========================================

CREATE TABLE IF NOT EXISTS user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  vault_id UUID, -- Will reference vaults when source-files module is installed
  actions permission_action[] DEFAULT '{}',
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  granted_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_resource ON user_permissions(resource);

-- ===========================================
-- MODULE ACCESS (Sidebar module allowlist)
-- ===========================================
-- Controls which teams / individual users may see a sidebar module.
--
-- This is deliberately an ALLOWLIST WITH AN OPEN DEFAULT, not a permission
-- grant: a module with no rows here is visible to the whole org. Only once an
-- admin adds a subject does the module become restricted to exactly the listed
-- teams and users (plus org admins). Modelling it as a normal team_permissions
-- resource would have meant every existing team needing an explicit 'view'
-- grant before it could see anything, so restricting one module would have
-- silently hidden all the others.
--
-- module_id is the ModuleId from src/types/modules.ts ('customers'), NOT the
-- 'module:customers' resource string used by team_permissions.

CREATE TABLE IF NOT EXISTS module_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  granted_by UUID REFERENCES users(id),
  -- Exactly one subject per row
  CHECK ((team_id IS NULL) <> (user_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_module_access_org_module ON module_access(org_id, module_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_module_access_team
  ON module_access(org_id, module_id, team_id) WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_module_access_user
  ON module_access(org_id, module_id, user_id) WHERE user_id IS NOT NULL;

-- RLS for teams
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_reviewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view org teams" ON teams;
CREATE POLICY "Users can view org teams"
  ON teams FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can create teams" ON teams;
CREATE POLICY "Admins can create teams"
  ON teams FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can update teams" ON teams;
CREATE POLICY "Admins can update teams"
  ON teams FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can delete teams" ON teams;
CREATE POLICY "Admins can delete teams"
  ON teams FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin() AND NOT is_system);

DROP POLICY IF EXISTS "Users can view team members" ON team_members;
CREATE POLICY "Users can view team members"
  ON team_members FOR SELECT
  USING (team_id IN (SELECT id FROM teams WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage team members" ON team_members;
CREATE POLICY "Admins can manage team members"
  ON team_members FOR ALL
  USING (team_id IN (SELECT id FROM teams WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND is_org_admin());

DROP POLICY IF EXISTS "Users can view team reviewers" ON team_reviewers;
CREATE POLICY "Users can view team reviewers"
  ON team_reviewers FOR SELECT
  USING (team_id IN (SELECT id FROM teams WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage team reviewers" ON team_reviewers;
CREATE POLICY "Admins can manage team reviewers"
  ON team_reviewers FOR ALL
  USING (team_id IN (SELECT id FROM teams WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND is_org_admin());

DROP POLICY IF EXISTS "Users can view team permissions" ON team_permissions;
CREATE POLICY "Users can view team permissions"
  ON team_permissions FOR SELECT
  USING (team_id IN (SELECT id FROM teams WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage team permissions" ON team_permissions;
CREATE POLICY "Admins can manage team permissions"
  ON team_permissions FOR ALL
  USING (team_id IN (SELECT id FROM teams WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND is_org_admin());

DROP POLICY IF EXISTS "Users can view permission presets" ON permission_presets;
CREATE POLICY "Users can view permission presets"
  ON permission_presets FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage permission presets" ON permission_presets;
CREATE POLICY "Admins can manage permission presets"
  ON permission_presets FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Users can view their permissions" ON user_permissions;
CREATE POLICY "Users can view their permissions"
  ON user_permissions FOR SELECT
  USING (user_id = auth.uid() OR 
    user_id IN (SELECT id FROM users WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage user permissions" ON user_permissions;
CREATE POLICY "Admins can manage user permissions"
  ON user_permissions FOR ALL
  USING (user_id IN (SELECT id FROM users WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND is_org_admin());

DROP POLICY IF EXISTS "Users can view module access" ON module_access;
CREATE POLICY "Users can view module access"
  ON module_access FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage module access" ON module_access;
CREATE POLICY "Admins can manage module access"
  ON module_access FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- ===========================================
-- JOB TITLES
-- ===========================================

CREATE TABLE IF NOT EXISTS job_titles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6b7280',
  icon TEXT DEFAULT 'User',
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_job_titles_org_id ON job_titles(org_id);

CREATE TABLE IF NOT EXISTS user_job_titles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id UUID NOT NULL REFERENCES job_titles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by UUID REFERENCES users(id),
  
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_job_titles_user_id ON user_job_titles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_job_titles_title_id ON user_job_titles(title_id);

ALTER TABLE job_titles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_job_titles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view job titles" ON job_titles;
CREATE POLICY "Users can view job titles"
  ON job_titles FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage job titles" ON job_titles;
CREATE POLICY "Admins can manage job titles"
  ON job_titles FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Users can view title assignments" ON user_job_titles;
CREATE POLICY "Users can view title assignments"
  ON user_job_titles FOR SELECT
  USING (title_id IN (SELECT id FROM job_titles WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage title assignments" ON user_job_titles;
CREATE POLICY "Admins can manage title assignments"
  ON user_job_titles FOR ALL
  USING (title_id IN (SELECT id FROM job_titles WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND is_org_admin());

-- ===========================================
-- PENDING ORG MEMBERS (Invitations)
-- ===========================================

CREATE TABLE IF NOT EXISTS pending_org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role user_role DEFAULT 'engineer',
  team_ids UUID[] DEFAULT '{}',
  vault_ids UUID[] DEFAULT '{}',
  workflow_role_ids UUID[] DEFAULT '{}',
  notes TEXT,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  claimed_at TIMESTAMPTZ,
  claimed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  
  UNIQUE(org_id, email)
);

-- Ensure columns exist for tables created with older schema versions
ALTER TABLE pending_org_members ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE pending_org_members ADD COLUMN IF NOT EXISTS vault_ids UUID[] DEFAULT '{}';
ALTER TABLE pending_org_members ADD COLUMN IF NOT EXISTS workflow_role_ids UUID[] DEFAULT '{}';
ALTER TABLE pending_org_members ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_pending_org_members_org_id ON pending_org_members(org_id);
CREATE INDEX IF NOT EXISTS idx_pending_org_members_email ON pending_org_members(email);

ALTER TABLE pending_org_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view pending members" ON pending_org_members;
CREATE POLICY "Admins can view pending members"
  ON pending_org_members FOR SELECT
  USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin()
    OR LOWER(email) = LOWER((SELECT email FROM users WHERE id = auth.uid()))
  );

DROP POLICY IF EXISTS "Admins can manage pending members" ON pending_org_members;
CREATE POLICY "Admins can manage pending members"
  ON pending_org_members FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- ===========================================
-- ADMIN RECOVERY CODES
-- ===========================================

CREATE TABLE IF NOT EXISTS admin_recovery_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  description TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_used BOOLEAN DEFAULT false,
  used_by UUID REFERENCES users(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ,
  used_from_ip TEXT,
  is_revoked BOOLEAN DEFAULT false,
  revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_recovery_codes_org ON admin_recovery_codes(org_id);

ALTER TABLE admin_recovery_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view recovery codes" ON admin_recovery_codes;
CREATE POLICY "Admins can view recovery codes"
  ON admin_recovery_codes FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can create recovery codes" ON admin_recovery_codes;
CREATE POLICY "Admins can create recovery codes"
  ON admin_recovery_codes FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can revoke recovery codes" ON admin_recovery_codes;
CREATE POLICY "Admins can revoke recovery codes"
  ON admin_recovery_codes FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- ===========================================
-- USER SESSIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL,
  machine_name TEXT,
  platform TEXT,
  os_version TEXT,
  app_version TEXT,
  is_active BOOLEAN DEFAULT true,
  last_active TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, machine_id)
);

-- Add new columns to existing user_sessions table (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_sessions' AND column_name = 'platform') THEN
    ALTER TABLE user_sessions ADD COLUMN platform TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_sessions' AND column_name = 'is_active') THEN
    ALTER TABLE user_sessions ADD COLUMN is_active BOOLEAN DEFAULT true;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_sessions' AND column_name = 'last_seen') THEN
    ALTER TABLE user_sessions ADD COLUMN last_seen TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_org_id ON user_sessions(org_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_last_seen ON user_sessions(last_seen);
CREATE INDEX IF NOT EXISTS idx_user_sessions_is_active ON user_sessions(is_active);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their sessions" ON user_sessions;
CREATE POLICY "Users can view their sessions"
  ON user_sessions FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Org members can view sessions" ON user_sessions;
CREATE POLICY "Org members can view sessions"
  ON user_sessions FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can manage their sessions" ON user_sessions;
CREATE POLICY "Users can manage their sessions"
  ON user_sessions FOR ALL
  USING (user_id = auth.uid());

-- ===========================================
-- NOTIFICATIONS (Generic - Module Agnostic)
-- ===========================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Notification type and category
  type TEXT NOT NULL,
  category TEXT,
  
  -- Content
  title TEXT NOT NULL,
  message TEXT,
  priority TEXT DEFAULT 'normal',
  
  -- Generic entity reference (replaces module-specific FKs)
  entity_type TEXT,
  entity_id UUID,
  
  -- Sender
  from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Action
  action_url TEXT,
  action_type TEXT,
  action_completed BOOLEAN DEFAULT false,
  action_completed_at TIMESTAMPTZ,
  
  -- Status
  read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_org_id ON notifications(org_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read) WHERE read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications(entity_type, entity_id);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their notifications" ON notifications;
CREATE POLICY "Users can view their notifications"
  ON notifications FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their notifications" ON notifications;
CREATE POLICY "Users can update their notifications"
  ON notifications FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "System can create notifications" ON notifications;
CREATE POLICY "System can create notifications"
  ON notifications FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- ===========================================
-- COLOR SWATCHES (Personal preferences)
-- ===========================================

CREATE TABLE IF NOT EXISTS color_swatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  color TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_color_swatches_user_id ON color_swatches(user_id);

ALTER TABLE color_swatches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their color swatches" ON color_swatches;
CREATE POLICY "Users can view their color swatches"
  ON color_swatches FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can manage their color swatches" ON color_swatches;
CREATE POLICY "Users can manage their color swatches"
  ON color_swatches FOR ALL
  USING (user_id = auth.uid());

-- ===========================================
-- CORE FUNCTIONS
-- ===========================================

-- The membership gate every SECURITY DEFINER RPC that takes a p_org_id must pass.
--
-- SECURITY DEFINER runs as the schema owner, so RLS does not apply and the
-- policies on organizations, files and the rest are simply not consulted.
-- p_org_id then becomes an unauthenticated instruction: whatever organization
-- the caller names is the organization the function operates on. PostgREST
-- exposes every function in the public schema that the calling role may
-- execute, and a function created without an explicit REVOKE is executable by
-- PUBLIC, which includes anon - so the argument is reachable without logging in
-- at all. This raises instead, and every such function calls it first.
--
-- A caller who names an organization that does not exist gets the same
-- authorization error as one who names an organization they are not in: the
-- alternative is a probe that reports which organization IDs are real, and the
-- caller has no business knowing either way. A NULL argument is a client bug
-- rather than an attack, so it says so.
CREATE OR REPLACE FUNCTION require_org_member(p_org_id UUID)
RETURNS VOID AS $$
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Not authorized for this organization'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION require_org_member(UUID) TO authenticated;

-- The same question as require_org_member(), for the callers that answer with a
-- value rather than by raising - a set-returning function that returns no rows,
-- or one that returns {"success": false, ...}.
--
-- It exists so that those callers stop writing the test out by hand. The
-- hand-written form was
--
--   p_org_id NOT IN (SELECT org_id FROM users WHERE id = auth.uid())
--
-- which is NULL, not true, for an account whose users.org_id is still NULL, so
-- the IF was not taken and the function proceeded. This returns a strict
-- boolean: false for a NULL argument, false for no JWT, false for a user with
-- no organization, false for a different organization. There is no input for
-- which it is neither true nor false, which is the whole point.
CREATE OR REPLACE FUNCTION is_org_member(p_org_id UUID)
RETURNS BOOLEAN AS $$
  SELECT p_org_id IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM users
       WHERE id = auth.uid() AND org_id = p_org_id
     );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION is_org_member(UUID) TO authenticated;

-- Who is acting. The only honest answer to that question inside a SECURITY
-- DEFINER function.
--
-- Several RPCs took the acting user as a p_user_id argument and wrote it into
-- files.checked_out_by, activity.user_id and workflow_history.performed_by. The
-- caller therefore chose what the audit trail said, and could name anyone: the
-- record of who locked a file was whatever the request body claimed. Every one
-- of those functions now derives the actor here and ignores the argument, which
-- is kept only so that existing callers - api/routes/files.ts and the renderer -
-- keep compiling and keep working. They already pass the signed-in user's id, so
-- nothing changes for them except that it is no longer load-bearing.
CREATE OR REPLACE FUNCTION current_actor_id()
RETURNS UUID AS $$
DECLARE
  v_uid UUID;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  RETURN v_uid;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION current_actor_id() TO authenticated;

-- Gate for a function that takes some other user's id and answers questions
-- about them: the two must share an organization. Same reasoning as
-- require_org_member - an id that belongs to nobody gets the same refusal as one
-- that belongs to another organization, so the function is not a directory of
-- which user ids exist.
CREATE OR REPLACE FUNCTION require_same_org_user(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_actor UUID;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_actor := current_actor_id();

  IF p_user_id = v_actor THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM users target
    JOIN users actor ON actor.org_id = target.org_id
    WHERE target.id = p_user_id AND actor.id = v_actor
  ) THEN
    RAISE EXCEPTION 'Not authorized for this user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION require_same_org_user(UUID) TO authenticated;

-- ===========================================
-- WHO MAY EXECUTE WHAT
-- ===========================================
-- The single list of functions an unauthenticated caller is allowed to reach.
-- Everything else in public is withdrawn from anon by
-- enforce_anon_execute_posture() below.
--
-- Keep this short and justify every entry. A function here is reachable over
-- PostgREST by anyone on the internet holding the publishable anon key.
CREATE OR REPLACE FUNCTION anon_execute_allowlist()
RETURNS TABLE (signature TEXT, reason TEXT)
LANGUAGE sql IMMUTABLE AS $$
  SELECT * FROM (VALUES
    -- The sign-in screen calls this before anyone has signed in, to decide which
    -- sign-in buttons to show. It takes an org slug, not an org id, and returns
    -- only which auth methods are enabled.
    ('get_org_auth_providers(text)', 'sign-in screen, pre-login'),
    -- File share links are opened by recipients who are not BluePLM users. The
    -- unguessable token in the link is the credential - which is only true
    -- since generate_share_token() started producing 128 bits from a strong
    -- source instead of twelve characters of random().
    ('validate_share_link(text)', 'share link recipients, pre-login'),
    -- The download itself. Split out of validate_share_link() so that asking
    -- whether a link is good no longer spends one of its downloads.
    ('consume_share_link(text)', 'share link recipients, pre-login')
  ) AS a(signature, reason);
$$;

-- Withdraw EXECUTE from anon on everything in public except that allowlist.
--
-- The previous version of this did the wrong thing in two ways, and the
-- combination is why 149 functions were reachable by anon on a stock Supabase
-- project while the verification script printed an all-clear.
--
-- First, it revoked FROM PUBLIC. Supabase's bootstrap runs
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
--
-- which *adds* to the built-in default rather than replacing it, so a new
-- function's proacl is
-- `{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`.
-- REVOKE ... FROM PUBLIC strips only the leading `=X/postgres`. The explicit
-- `anon=X/postgres` survives untouched and PostgREST keeps exposing the
-- function to anon. The only thing that removes it is naming the role.
--
-- Second, it asked `has_function_privilege('public', ...)` to decide whether
-- there was anything to do. On a database where the bootstrap had run, that is
-- false for a function that anon can nonetheless execute, so the loop selected
-- nothing and the function returned 0 - a clean bill of health over a fully
-- open schema.
--
-- The scope is also wider than before. It used to cover only SECURITY DEFINER
-- functions taking a p_org_id, which missed every function that reaches an
-- organization through an entity id instead - checkout_file, move_file and the
-- rest. anon has no business executing anything here, so the rule is now
-- "nothing except the allowlist" rather than an attempt to enumerate the
-- dangerous ones.
--
-- Doing this by class rather than one REVOKE per function is still deliberate:
-- these modules DROP and re-CREATE functions, which discards the ACL, so the
-- privileges are rebuilt from default on every install and the revoke has to be
-- part of the install to mean anything. core.sql and each module call this at
-- the end of their own file.
--
-- Where a function is reachable through PUBLIC as well as through the explicit
-- anon grant, both have to go. Withdrawing PUBLIC would also take the privilege
-- from any other role that only held it that way, so every such role's access
-- is first pinned down as an explicit grant. No role but anon loses anything.
CREATE OR REPLACE FUNCTION enforce_anon_execute_posture()
RETURNS INTEGER AS $$
DECLARE
  v_preserve TEXT[];
  v_allowed TEXT[];
  v_keep TEXT[];
  v_role TEXT;
  r RECORD;
  d RECORD;
  v_count INTEGER := 0;
  v_stuck TEXT[] := '{}';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RETURN 0;
  END IF;

  -- Roles an ACL can actually constrain. Superusers ignore ACLs, pg_* are
  -- built-in, and anon is the role being withdrawn.
  v_preserve := ARRAY(
    SELECT rolname FROM pg_roles
    WHERE NOT rolsuper AND rolname <> 'anon' AND rolname NOT LIKE 'pg\_%'
  );
  v_allowed := ARRAY(SELECT signature FROM anon_execute_allowlist());

  -- EVERY ROUTINE, NOT JUST prokind = 'f'
  --
  -- This loop filtered `prokind = 'f'` while check_anon_reach() filtered
  -- nothing, so the two disagreed about what an anon-reachable routine is. A
  -- PROCEDURE created in public - which a later migration may well do - was
  -- graded blocking by the check, untouched by this sweep, and the remedy the
  -- verifier printed was a call to this function. It returned 0 and changed
  -- nothing, for ever. That is the same defect v90 had, in a new place: a
  -- blocking condition with no way out.
  --
  -- ON ROUTINE rather than ON FUNCTION is the whole fix: FUNCTION covers
  -- functions, aggregates and window functions but not procedures, and ROUTINE
  -- covers all four.
  FOR r IN
    SELECT p.oid, p.oid::regprocedure::TEXT AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT (p.oid::regprocedure::TEXT = ANY (v_allowed))
  LOOP
    -- Nothing this role granted, nothing this role can take back. Attempting it
    -- produces "WARNING: no privileges could be revoked" and, worse, the
    -- re-grant below then fires a warning per preserved role while achieving
    -- nothing. Skip it and record it, so the count this function returns is a
    -- count of things that changed rather than of things it tried.
    IF EXISTS (
      SELECT 1 FROM unnest(anon_revoke_grantors(r.oid)) g
      WHERE NOT pg_has_role(current_user, g, 'MEMBER')
    ) AND NOT COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
    THEN
      v_stuck := array_append(v_stuck, r.signature);
      CONTINUE;
    END IF;

    SELECT ARRAY(
      SELECT role_name FROM unnest(v_preserve) AS role_name
      WHERE has_function_privilege(role_name, r.oid, 'EXECUTE')
    ) INTO v_keep;

    EXECUTE format('REVOKE EXECUTE ON ROUTINE %s FROM anon', r.signature);

    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      FOREACH v_role IN ARRAY v_keep LOOP
        EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO %I', r.signature, v_role);
      END LOOP;
      EXECUTE format('REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC', r.signature);
    END IF;

    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      v_stuck := array_append(v_stuck, r.signature);
    ELSE
      v_count := v_count + 1;
    END IF;
  END LOOP;

  IF array_length(v_stuck, 1) > 0 THEN
    RAISE WARNING 'anon can still execute % routine(s) in public that % is not permitted to revoke: %. They were granted by a role you are not a member of - on Supabase that means an extension installed into public by supabase_admin. check_anon_reach() reports them as advisory, so they will not withhold the stamp, but anon can call them.',
      array_length(v_stuck, 1), current_user, array_to_string(v_stuck, ', ');
  END IF;

  -- Cancel the bootstrap's explicit anon grant on routines created from here on.
  --
  -- Default privileges are recorded per granting role, so each role that has one
  -- needs its own statement. Supabase sets them for postgres and also for
  -- supabase_admin, and postgres is not a member of supabase_admin, so the
  -- second one cannot be cancelled from the SQL editor by anybody. That is not
  -- a fault to be fixed here and it must not block a release:
  -- check_anon_reach() reports it as advisory for a caller who could not have
  -- cancelled it, and tools/emergency-lockdown.sql says the same.
  --
  -- ON ROUTINES, not ON FUNCTIONS: they write the same pg_default_acl row, but
  -- the ROUTINES spelling is the one that says what is meant, now that this
  -- file cares about procedures.
  FOR d IN
    SELECT DISTINCT pg_get_userbyid(a.defaclrole) AS grantor
    FROM pg_default_acl a
    JOIN pg_namespace n ON n.oid = a.defaclnamespace
    WHERE n.nspname = 'public'
      AND a.defaclobjtype = 'f'
      AND EXISTS (
        SELECT 1 FROM aclexplode(a.defaclacl) x
        WHERE x.grantee = 'anon'::regrole AND x.privilege_type = 'EXECUTE'
      )
  LOOP
    -- NOTE: everything inside this handler is swallowed, including a RAISE that
    -- was meant to abort. Nothing here is a gate, so that is safe today. If a
    -- check is ever added to this loop, put it before the BEGIN.
    BEGIN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON ROUTINES FROM anon',
        d.grantor
      );
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'Could not cancel the anon default privilege held by % - % is not a member of that role. Advisory: it governs routines created BY %, and BluePLM''s are created by %, which this sweep closes.',
        d.grantor, current_user, d.grantor, current_user;
    END;
  END LOOP;

  -- MAKE THE NEXT ROUTINE BORN CLOSED
  --
  -- The previous release said this was impossible:
  --
  --   "There is no version of this loop that makes a later function born
  --    closed."
  --
  -- That was measured with `IN SCHEMA public` and is only true of that form.
  -- Postgres builds a new object's ACL in get_user_default_acl(): if there is
  -- no default-privilege row at all it uses the hard-wired default, which for a
  -- routine is EXECUTE to PUBLIC; if there IS a *global* row - one written
  -- without IN SCHEMA - that row REPLACES the hard-wired default, and the
  -- schema-scoped row is then merged on top of it. So a schema-scoped REVOKE
  -- cannot remove `=X/postgres`, and a global one can, which is exactly the
  -- asymmetry that made the claim look true.
  --
  -- Measured in the harness on Postgres 17, as postgres, after the loop above
  -- has removed anon from the schema-scoped row:
  --
  --   before  {=X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
  --   after   {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
  --
  -- anon f, authenticated t, and the same for a procedure. A function or
  -- procedure created by this role afterwards - by a migration written next
  -- year, by anybody - is not reachable by anon and needs no sweep to make it
  -- so. This is structural in a way that sweeping after the fact is not: the
  -- sweep only ever closes what already exists.
  --
  -- Scoped to current_user because that is the only role whose default
  -- privileges we are entitled to change, and it is the role that creates every
  -- BluePLM object. It does not touch supabase_admin's, and it does not need
  -- to: supabase_admin's row governs objects supabase_admin creates.
  --
  -- check_anon_reach() stays blocking regardless. Being born closed removes the
  -- usual way in; it is not a reason to stop looking.
  BEGIN
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON ROUTINES FROM PUBLIC, anon',
      current_user
    );
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Could not set a global default privilege for % - routines created later will be born reachable by anon and will need this sweep run again.',
      current_user;
  END;

  -- Views and materialized views.
  --
  -- These were not swept at all, and nothing checked them. parts_with_pricing
  -- is a view, so relkind = 'v', and every inventory in the release filtered
  -- relkind = 'r'. It was readable at GET /rest/v1/parts_with_pricing with no
  -- JWT, and it returned every organization's rows because a view without
  -- security_invoker reads its base tables as its owner and the owner holds
  -- BYPASSRLS. Revoking anon is half the fix; the other half is
  -- security_invoker on the view itself, which is set where the view is
  -- defined and checked by check_anon_reach().
  --
  -- The allowlist is anon_read_allowlist(), which holds schema_version and
  -- nothing else. Nothing else pre-login reads a relation directly.
  --
  -- has_any_column_privilege on the way in, because a column-level grant is
  -- invisible to has_table_privilege and this loop would step over it while
  -- check_anon_reach() reported it - a blocking condition the remedy could not
  -- clear, which is the defect this whole file has now been through twice.
  -- REVOKE ALL ON TABLE does remove column grants (measured in the harness:
  -- has_any_column_privilege goes t -> f), so the remedy itself needed nothing.
  FOR r IN
    SELECT c.oid, quote_ident(c.relname) AS signature
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('v', 'm')
      AND has_any_column_privilege('anon', c.oid, 'SELECT')
      AND NOT EXISTS (SELECT 1 FROM anon_read_allowlist() a WHERE a.relname = c.relname)
  LOOP
    SELECT ARRAY(
      SELECT role_name FROM unnest(v_preserve) AS role_name
      WHERE has_any_column_privilege(role_name, r.oid, 'SELECT')
    ) INTO v_keep;

    EXECUTE format('REVOKE ALL ON TABLE public.%s FROM anon', r.signature);

    IF has_any_column_privilege('anon', r.oid, 'SELECT') THEN
      FOREACH v_role IN ARRAY v_keep LOOP
        EXECUTE format('GRANT SELECT ON TABLE public.%s TO %I', r.signature, v_role);
      END LOOP;
      EXECUTE format('REVOKE ALL ON TABLE public.%s FROM PUBLIC', r.signature);
    END IF;

    v_count := v_count + 1;
  END LOOP;

  -- The allowlist has to be granted back explicitly, because cancelling the
  -- default privilege means a re-created allowlisted function no longer gets
  -- anon from the bootstrap.
  FOR r IN SELECT signature FROM anon_execute_allowlist() LOOP
    IF to_regprocedure('public.' || r.signature) IS NOT NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon', r.signature);
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION enforce_anon_execute_posture() FROM PUBLIC, anon;

-- Kept under its old name so that an older copy of a module file - which calls
-- this at the end - still applies the current posture rather than failing.
CREATE OR REPLACE FUNCTION revoke_public_execute_on_org_rpcs()
RETURNS INTEGER AS $$
  SELECT enforce_anon_execute_posture();
$$ LANGUAGE sql;

REVOKE ALL ON FUNCTION revoke_public_execute_on_org_rpcs() FROM PUBLIC, anon;

-- Full is_org_admin implementation
CREATE OR REPLACE FUNCTION is_org_admin()
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID;
  v_user_org_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;
  
  SELECT org_id INTO v_user_org_id FROM users WHERE id = v_user_id;
  
  IF v_user_org_id IS NULL THEN
    RETURN false;
  END IF;
  
  -- Admin means membership of the Administrators team OR users.role = 'admin'.
  -- These two notions drifted apart: the API routes check users.role while this
  -- function checked only the team, so an admin outside that team could use
  -- some features and be refused others.
  RETURN EXISTS(
    SELECT 1
    FROM users u
    WHERE u.id = v_user_id
      AND u.org_id = v_user_org_id
      AND u.role = 'admin'
  ) OR EXISTS(
    SELECT 1
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = v_user_id
      AND t.org_id = v_user_org_id
      AND t.name = 'Administrators'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_org_admin(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID;
  v_user_org_id UUID;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;
  
  SELECT org_id INTO v_user_org_id FROM users WHERE id = v_user_id;
  
  IF v_user_org_id IS NULL THEN
    RETURN false;
  END IF;

  -- Whether some other organization's user is an admin is not a question this
  -- answers. `false` rather than a raise, because RLS policies call this and a
  -- policy wants a predicate; the effect either way is that the caller learns
  -- nothing about a user outside their own organization.
  IF auth.uid() IS NOT NULL AND v_user_id <> auth.uid()
     AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.org_id = v_user_org_id) THEN
    RETURN false;
  END IF;
  
  -- Same dual definition as the no-argument overload above; keep them in step.
  RETURN EXISTS(
    SELECT 1
    FROM users u
    WHERE u.id = v_user_id
      AND u.org_id = v_user_org_id
      AND u.role = 'admin'
  ) OR EXISTS(
    SELECT 1
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = v_user_id
      AND t.org_id = v_user_org_id
      AND t.name = 'Administrators'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION is_org_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION is_org_admin(UUID) TO authenticated;

-- Get user permissions
DROP FUNCTION IF EXISTS get_user_permissions(UUID);
CREATE OR REPLACE FUNCTION get_user_permissions(p_user_id UUID, p_vault_id UUID DEFAULT NULL)
RETURNS TABLE (
  resource TEXT,
  vault_id UUID,
  actions permission_action[]
) AS $$
BEGIN
  -- The full permission map of any user in the database, for whoever asked.
  PERFORM require_same_org_user(p_user_id);

  RETURN QUERY
  SELECT 
    tp.resource,
    tp.vault_id,
    array_agg(DISTINCT a) AS actions
  FROM team_members tm
  JOIN team_permissions tp ON tm.team_id = tp.team_id
  CROSS JOIN unnest(tp.actions) AS a
  WHERE tm.user_id = p_user_id
    AND (
      (p_vault_id IS NULL AND tp.vault_id IS NULL) OR
      (p_vault_id IS NOT NULL AND (tp.vault_id IS NULL OR tp.vault_id = p_vault_id))
    )
  GROUP BY tp.resource, tp.vault_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- User has permission check
DROP FUNCTION IF EXISTS user_has_permission(UUID, TEXT, permission_action);
CREATE OR REPLACE FUNCTION user_has_permission(
  p_user_id UUID,
  p_resource TEXT,
  p_action permission_action,
  p_vault_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_has_permission BOOLEAN := false;
BEGIN
  -- RLS policies on files and elsewhere reach this through
  -- user_has_team_permission(auth.uid(), ...), so it has to stay a predicate:
  -- an unauthenticated caller has no permissions, and that is `false`, not an
  -- error. Raising here would turn a policy denial into a failed statement.
  IF p_user_id IS NULL OR auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  -- Asking about somebody else is only allowed within your own organization.
  IF p_user_id <> auth.uid() THEN
    PERFORM require_same_org_user(p_user_id);
  END IF;

  IF is_org_admin(p_user_id) THEN
    RETURN true;
  END IF;
  
  SELECT EXISTS(
    SELECT 1
    FROM team_members tm
    JOIN team_permissions tp ON tm.team_id = tp.team_id
    WHERE tm.user_id = p_user_id
      AND tp.resource = p_resource
      AND (
        p_action = ANY(tp.actions)
        -- An 'admin' grant on a resource implies every action on it. The UI has
        -- always treated it that way; this function did not, so a team granted
        -- only 'admin' was shown controls the database then refused.
        OR 'admin'::permission_action = ANY(tp.actions)
      )
      AND (tp.vault_id IS NULL OR tp.vault_id = p_vault_id)
  ) INTO v_has_permission;
  
  RETURN v_has_permission;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- User has team permission (convenience wrapper)
CREATE OR REPLACE FUNCTION user_has_team_permission(
  p_resource TEXT,
  p_action permission_action,
  p_vault_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN user_has_permission(auth.uid(), p_resource, p_action, p_vault_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_user_permissions(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION user_has_permission(UUID, TEXT, permission_action, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION user_has_team_permission(TEXT, permission_action, UUID) TO authenticated;

-- Auto-set user org_id (no-op stub for backwards compatibility)
CREATE OR REPLACE FUNCTION auto_set_user_org_id_func()
RETURNS TRIGGER AS $$
BEGIN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_set_user_org_id ON users;
CREATE TRIGGER auto_set_user_org_id
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION auto_set_user_org_id_func();

-- Ensure user org_id RPC
CREATE OR REPLACE FUNCTION ensure_user_org_id()
RETURNS JSON AS $$
DECLARE
  current_user_id UUID;
  current_org_id UUID;
  user_email TEXT;
  auth_user RECORD;
  pending RECORD;
  user_exists BOOLEAN;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  SELECT org_id, email INTO current_org_id, user_email
  FROM users WHERE id = current_user_id;
  
  user_exists := user_email IS NOT NULL;
  
  IF NOT user_exists THEN
    SELECT id, email, raw_user_meta_data INTO auth_user
    FROM auth.users WHERE id = current_user_id;
    
    IF auth_user.id IS NULL THEN
      RETURN json_build_object('success', false, 'error', 'Auth user not found');
    END IF;
    
    SELECT * INTO pending
    FROM pending_org_members
    WHERE LOWER(email) = LOWER(auth_user.email)
      AND claimed_at IS NULL
    LIMIT 1;
    
    INSERT INTO public.users (id, email, full_name, avatar_url, org_id, role)
    VALUES (
      auth_user.id,
      auth_user.email,
      COALESCE(auth_user.raw_user_meta_data->>'full_name', auth_user.raw_user_meta_data->>'name'),
      COALESCE(auth_user.raw_user_meta_data->>'avatar_url', auth_user.raw_user_meta_data->>'picture'),
      pending.org_id,
      COALESCE(pending.role, 'engineer')::user_role
    )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = COALESCE(EXCLUDED.full_name, public.users.full_name),
      avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url),
      org_id = COALESCE(public.users.org_id, EXCLUDED.org_id),
      role = CASE WHEN public.users.org_id IS NULL THEN EXCLUDED.role ELSE public.users.role END;
    
    IF pending.id IS NOT NULL THEN
      PERFORM apply_pending_team_memberships(current_user_id);
    END IF;
    
    SELECT org_id, email INTO current_org_id, user_email
    FROM users WHERE id = current_user_id;
    
    RETURN json_build_object(
      'success', true,
      'created_user', true,
      'has_org', current_org_id IS NOT NULL,
      'org_id', current_org_id
    );
  END IF;
  
  IF current_org_id IS NOT NULL THEN
    RETURN json_build_object('success', true, 'has_org', true, 'org_id', current_org_id);
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'has_org', false,
    'message', 'User needs to join an organization via org code'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION ensure_user_org_id() TO authenticated;

-- Update last online
CREATE OR REPLACE FUNCTION update_last_online()
RETURNS JSON AS $$
DECLARE
  current_user_id UUID;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  UPDATE users SET last_online = NOW() WHERE id = current_user_id;
  
  RETURN json_build_object('success', true, 'timestamp', NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION update_last_online() TO authenticated;

-- Join org by slug
CREATE OR REPLACE FUNCTION join_org_by_slug(p_org_slug TEXT)
RETURNS JSON AS $$
DECLARE
  current_user_id UUID;
  current_org_id UUID;
  target_org_id UUID;
  target_org_name TEXT;
  default_team_id UUID;
  user_email TEXT;
  email_domain TEXT;
  enforce_domain BOOLEAN;
  allowed_domains TEXT[];
  auth_user_email TEXT;
  auth_user_name TEXT;
  auth_user_avatar TEXT;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  SELECT org_id, email INTO current_org_id, user_email
  FROM users WHERE id = current_user_id;
  
  IF user_email IS NULL THEN
    SELECT email, 
           COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name'),
           COALESCE(raw_user_meta_data->>'avatar_url', raw_user_meta_data->>'picture')
    INTO auth_user_email, auth_user_name, auth_user_avatar
    FROM auth.users WHERE id = current_user_id;
    
    IF auth_user_email IS NULL THEN
      RETURN json_build_object('success', false, 'error', 'Authentication error', 'retry', false);
    END IF;
    
    INSERT INTO users (id, email, full_name, avatar_url, org_id)
    VALUES (current_user_id, auth_user_email, auth_user_name, auth_user_avatar, NULL)
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = COALESCE(EXCLUDED.full_name, users.full_name),
      avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url);
    
    user_email := auth_user_email;
  END IF;
  
  IF current_org_id IS NOT NULL THEN
    RETURN json_build_object('success', false, 'error', 'You are already a member of an organization');
  END IF;
  
  SELECT id, name, email_domains, default_new_user_team_id,
         COALESCE((settings->>'enforce_email_domain')::boolean, false)
  INTO target_org_id, target_org_name, allowed_domains, default_team_id, enforce_domain
  FROM organizations WHERE slug = p_org_slug;
  
  IF target_org_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Organization not found');
  END IF;
  
  IF EXISTS (SELECT 1 FROM blocked_users WHERE org_id = target_org_id AND LOWER(email) = LOWER(user_email)) THEN
    RETURN json_build_object('success', false, 'error', 'You have been blocked from this organization');
  END IF;
  
  IF enforce_domain AND array_length(allowed_domains, 1) > 0 THEN
    email_domain := split_part(user_email, '@', 2);
    IF NOT (email_domain = ANY(allowed_domains)) THEN
      RETURN json_build_object('success', false, 'error', 'Your email domain is not allowed');
    END IF;
  END IF;
  
  UPDATE users SET org_id = target_org_id WHERE id = current_user_id;
  
  IF default_team_id IS NOT NULL THEN
    INSERT INTO team_members (team_id, user_id, added_by)
    VALUES (default_team_id, current_user_id, current_user_id)
    ON CONFLICT (team_id, user_id) DO NOTHING;
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'org_id', target_org_id,
    'org_name', target_org_name,
    'added_to_default_team', default_team_id IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION join_org_by_slug(TEXT) TO authenticated;

-- Block user
CREATE OR REPLACE FUNCTION block_user(p_email TEXT, p_reason TEXT DEFAULT NULL)
RETURNS JSON AS $$
DECLARE
  current_user_id UUID;
  current_org_id UUID;
  target_user_id UUID;
  normalized_email TEXT;
BEGIN
  current_user_id := auth.uid();
  normalized_email := LOWER(TRIM(p_email));
  
  SELECT org_id INTO current_org_id FROM users WHERE id = current_user_id;
  
  IF current_org_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'You are not a member of any organization');
  END IF;
  
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can block users');
  END IF;
  
  SELECT id INTO target_user_id FROM users
  WHERE LOWER(email) = normalized_email AND org_id = current_org_id;
  
  IF target_user_id IS NOT NULL THEN
    DELETE FROM team_members
    WHERE user_id = target_user_id 
      AND team_id IN (SELECT id FROM teams WHERE org_id = current_org_id);
    
    UPDATE users SET org_id = NULL WHERE id = target_user_id;
    
    DELETE FROM pending_org_members
    WHERE org_id = current_org_id AND LOWER(email) = normalized_email;
  END IF;
  
  INSERT INTO blocked_users (org_id, email, blocked_by, reason)
  VALUES (current_org_id, normalized_email, current_user_id, p_reason)
  ON CONFLICT (org_id, email) DO UPDATE SET
    blocked_by = current_user_id,
    blocked_at = NOW(),
    reason = p_reason;
  
  RETURN json_build_object('success', true, 'message', 'User has been blocked');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION block_user(TEXT, TEXT) TO authenticated;

-- Unblock user
CREATE OR REPLACE FUNCTION unblock_user(p_email TEXT)
RETURNS JSON AS $$
DECLARE
  current_user_id UUID;
  current_org_id UUID;
  normalized_email TEXT;
BEGIN
  current_user_id := auth.uid();
  normalized_email := LOWER(TRIM(p_email));
  
  SELECT org_id INTO current_org_id FROM users WHERE id = current_user_id;
  
  IF current_org_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'You are not a member of any organization');
  END IF;
  
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can unblock users');
  END IF;
  
  DELETE FROM blocked_users
  WHERE org_id = current_org_id AND LOWER(email) = normalized_email;
  
  RETURN json_build_object('success', true, 'message', 'User has been unblocked');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION unblock_user(TEXT) TO authenticated;

-- Regenerate org slug
CREATE OR REPLACE FUNCTION regenerate_org_slug()
RETURNS JSON AS $$
DECLARE
  current_user_id UUID;
  current_org_id UUID;
  new_slug TEXT;
BEGIN
  current_user_id := auth.uid();
  
  SELECT u.org_id INTO current_org_id
  FROM users u WHERE u.id = current_user_id;
  
  IF current_org_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'You are not a member of any organization');
  END IF;
  
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can regenerate the organization code');
  END IF;
  
  new_slug := encode(gen_random_bytes(6), 'base64');
  new_slug := replace(replace(new_slug, '/', ''), '+', '');
  new_slug := substring(new_slug from 1 for 8);
  
  UPDATE organizations SET slug = new_slug WHERE id = current_org_id;
  
  RETURN json_build_object('success', true, 'new_slug', new_slug);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION regenerate_org_slug() TO authenticated;

-- Update organization branding (logo and contact info)
CREATE OR REPLACE FUNCTION update_org_branding(
  p_org_id UUID,
  p_logo_url TEXT DEFAULT NULL,
  p_logo_storage_path TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_website TEXT DEFAULT NULL,
  p_contact_email TEXT DEFAULT NULL
)
RETURNS JSON AS $$
BEGIN
  IF NOT is_org_member(p_org_id) THEN
    RETURN json_build_object('success', false, 'error', 'You are not a member of this organization');
  END IF;

  -- Verify user is an admin
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can update organization branding');
  END IF;
  
  -- Update the organization branding and contact fields
  -- Only update fields that are explicitly provided (not NULL)
  -- Empty strings are treated as NULL to clear the values
  UPDATE organizations 
  SET 
    logo_url = CASE WHEN p_logo_url IS NOT NULL THEN NULLIF(p_logo_url, '') ELSE logo_url END,
    logo_storage_path = CASE WHEN p_logo_storage_path IS NOT NULL THEN NULLIF(p_logo_storage_path, '') ELSE logo_storage_path END,
    phone = CASE WHEN p_phone IS NOT NULL THEN NULLIF(p_phone, '') ELSE phone END,
    website = CASE WHEN p_website IS NOT NULL THEN NULLIF(p_website, '') ELSE website END,
    contact_email = CASE WHEN p_contact_email IS NOT NULL THEN NULLIF(p_contact_email, '') ELSE contact_email END
  WHERE id = p_org_id;
  
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old function signature and grant on new one
DROP FUNCTION IF EXISTS update_org_branding(UUID, TEXT, TEXT);
GRANT EXECUTE ON FUNCTION update_org_branding(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Get org auth providers
--
-- Reachable by anon: the sign-in screen calls it before anyone has signed in.
-- That makes the difference between its two answers an oracle, and it used to
-- be a loud one. A real organization returned `auth_providers::json`, a jsonb
-- value rendered with jsonb's key ordering and no space after the colon; an
-- organization that does not exist returned a json_build_object() literal,
-- rendered with json's insertion ordering and ` : ` between key and value. The
-- two were distinguishable by whitespace alone, so anyone holding the
-- publishable key could enumerate org slugs and learn which SSO providers a
-- named target has enabled.
--
-- Both answers now go through the same jsonb value and the same cast, so an
-- organization with no configured providers and an organization that does not
-- exist are byte-identical. An organization that HAS configured providers is
-- still distinguishable, and has to be: the screen exists to show different
-- buttons. What is closed is the free enumeration of every slug.
CREATE OR REPLACE FUNCTION get_org_auth_providers(p_org_slug TEXT)
RETURNS JSON AS $$
DECLARE
  auth_settings JSONB;
BEGIN
  SELECT auth_providers INTO auth_settings
  FROM organizations WHERE slug = p_org_slug;

  RETURN COALESCE(
    auth_settings,
    jsonb_build_object(
      'users', jsonb_build_object('google', true, 'email', true, 'phone', true),
      'suppliers', jsonb_build_object('google', true, 'email', true, 'phone', true)
    )
  )::json;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_org_auth_providers(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_org_auth_providers(TEXT) TO anon;

-- Create default job titles
CREATE OR REPLACE FUNCTION create_default_job_titles(p_org_id UUID, p_created_by UUID DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  INSERT INTO job_titles (org_id, name, description, color, icon, is_system, created_by) VALUES
    (p_org_id, 'Design Engineer', 'CAD and product design', '#3b82f6', 'PenTool', TRUE, p_created_by),
    (p_org_id, 'Quality Engineer', 'Quality assurance and control', '#f59e0b', 'ShieldCheck', TRUE, p_created_by),
    (p_org_id, 'Manufacturing Engineer', 'Production and process engineering', '#ec4899', 'Factory', TRUE, p_created_by),
    (p_org_id, 'Purchasing Agent', 'Procurement and supplier management', '#14b8a6', 'ShoppingCart', TRUE, p_created_by),
    (p_org_id, 'Project Manager', 'Project oversight and coordination', '#8b5cf6', 'Briefcase', TRUE, p_created_by),
    (p_org_id, 'Document Controller', 'Release and document management', '#06b6d4', 'FileCheck', TRUE, p_created_by)
  ON CONFLICT (org_id, name) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- No require_org_member() here, and none in create_default_permission_teams
-- below: both run from the on_organization_created trigger, at an instant when
-- the new organization has no members at all, so a membership check would make
-- creating an organization impossible. Withdrawing the endpoint is the fix
-- instead - the trigger function is SECURITY DEFINER owned by the schema owner
-- and can still call them, while PostgREST can no longer reach them.
--
-- Withdrawing it needs the roles named. `REVOKE ALL ... FROM PUBLIC` was the
-- only protection these three had, and on Supabase it removed the implicit
-- PUBLIC grant while leaving the explicit `anon=X/postgres` that ALTER DEFAULT
-- PRIVILEGES had put there. As anon with no JWT, create_default_job_titles,
-- create_default_permission_teams and seed_customer_categories wrote 56 rows
-- into an organization the caller had never heard of. enforce_anon_execute_posture()
-- at the end of the file would catch this now, but a function whose entire
-- defence is its ACL should carry that ACL next to its own definition.
REVOKE ALL ON FUNCTION create_default_job_titles(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Create default permission teams
CREATE OR REPLACE FUNCTION create_default_permission_teams(p_org_id UUID, p_created_by UUID DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
  v_admins_id UUID;
  v_new_users_id UUID;
BEGIN
  INSERT INTO teams (org_id, name, description, color, icon, is_system, created_by)
  VALUES (p_org_id, 'Administrators', 'Full administrative access', '#eab308', 'Star', TRUE, p_created_by)
  ON CONFLICT (org_id, name) DO UPDATE SET description = EXCLUDED.description
  RETURNING id INTO v_admins_id;
  
  INSERT INTO teams (org_id, name, description, color, icon, is_default, is_system, created_by)
  VALUES (p_org_id, 'New Users', 'Default team for new org code signups', '#6b7280', 'UserPlus', TRUE, FALSE, p_created_by)
  ON CONFLICT (org_id, name) DO UPDATE SET description = EXCLUDED.description
  RETURNING id INTO v_new_users_id;
  
  UPDATE organizations SET default_new_user_team_id = v_new_users_id
  WHERE id = p_org_id AND default_new_user_team_id IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION create_default_permission_teams(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Apply pending team memberships
CREATE OR REPLACE FUNCTION apply_pending_team_memberships(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_pending RECORD;
  v_team_id UUID;
  v_vault_id UUID;
  v_org_id UUID;
  v_default_team_id UUID;
BEGIN
  SELECT * INTO v_pending
  FROM pending_org_members
  WHERE LOWER(email) = LOWER((SELECT email FROM users WHERE id = p_user_id))
    AND claimed_at IS NULL
  LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  IF v_pending.team_ids IS NOT NULL AND array_length(v_pending.team_ids, 1) > 0 THEN
    FOREACH v_team_id IN ARRAY v_pending.team_ids
    LOOP
      INSERT INTO team_members (team_id, user_id, added_by)
      VALUES (v_team_id, p_user_id, v_pending.invited_by)
      ON CONFLICT (team_id, user_id) DO NOTHING;
    END LOOP;
  ELSE
    SELECT default_new_user_team_id INTO v_default_team_id
    FROM organizations WHERE id = v_pending.org_id;
    
    IF v_default_team_id IS NOT NULL THEN
      INSERT INTO team_members (team_id, user_id, added_by)
      VALUES (v_default_team_id, p_user_id, v_pending.invited_by)
      ON CONFLICT (team_id, user_id) DO NOTHING;
    END IF;
  END IF;
  
  -- Opt-in vault access: grant the vaults selected on the invite (if any)
  IF v_pending.vault_ids IS NOT NULL AND array_length(v_pending.vault_ids, 1) > 0 THEN
    FOREACH v_vault_id IN ARRAY v_pending.vault_ids
    LOOP
      INSERT INTO vault_access (vault_id, user_id, granted_by)
      VALUES (v_vault_id, p_user_id, v_pending.invited_by)
      ON CONFLICT (vault_id, user_id) DO NOTHING;
    END LOOP;
  END IF;
  
  UPDATE pending_org_members
  SET claimed_at = NOW(), claimed_by = p_user_id
  WHERE id = v_pending.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger-only, and withdrawn rather than gated.
--
-- It takes a user id and adds that user to whatever teams and vaults a pending
-- invitation names - which, reachable by anon, is an endpoint for granting
-- someone else's user account access to someone else's organization. It cannot
-- take a membership check: it runs from claim_pending_membership() on the users
-- table at the moment an invited account first gets its org_id, and it also runs
-- under the API's service-role client during invite acceptance, where auth.uid()
-- is NULL. There is no caller with a JWT, so there is nothing to check and no
-- reason for it to be callable over PostgREST at all.
--
-- Naming the roles matters here for the same reason it did for
-- create_default_job_titles: FROM PUBLIC alone leaves the explicit anon grant.
REVOKE ALL ON FUNCTION apply_pending_team_memberships(UUID) FROM PUBLIC, anon, authenticated;

-- Claim pending membership trigger function
CREATE OR REPLACE FUNCTION claim_pending_membership()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM apply_pending_team_memberships(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS claim_pending_membership_trigger ON users;
CREATE TRIGGER claim_pending_membership_trigger
  AFTER INSERT OR UPDATE OF org_id ON users
  FOR EACH ROW
  WHEN (NEW.org_id IS NOT NULL)
  EXECUTE FUNCTION claim_pending_membership();

-- Handle new user (auth trigger)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  pending RECORD;
  pending_org UUID;
  pending_role TEXT;
BEGIN
  SELECT * INTO pending
  FROM pending_org_members
  WHERE LOWER(email) = LOWER(NEW.email)
    AND claimed_at IS NULL
  LIMIT 1;
  
  IF FOUND THEN
    pending_org := pending.org_id;
    pending_role := pending.role::TEXT;
  ELSE
    pending_org := NULL;
    pending_role := 'engineer';
  END IF;
  
  INSERT INTO public.users (id, email, full_name, avatar_url, org_id, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture'),
    pending_org,
    pending_role::user_role
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.users.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url),
    org_id = CASE 
      WHEN public.users.org_id IS NULL AND EXCLUDED.org_id IS NOT NULL 
      THEN EXCLUDED.org_id ELSE public.users.org_id END,
    role = CASE 
      WHEN public.users.org_id IS NULL AND EXCLUDED.org_id IS NOT NULL 
      THEN EXCLUDED.role ELSE public.users.role END;
  
  RETURN NEW;
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING 'User with email % already exists', NEW.email;
  RETURN NEW;
WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user error: % %', SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Handle new organization
CREATE OR REPLACE FUNCTION handle_new_organization()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM create_default_permission_teams(NEW.id, NULL);
  PERFORM create_default_job_titles(NEW.id, NULL);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_organization_created ON organizations;
CREATE TRIGGER on_organization_created
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION handle_new_organization();

-- Delete user account
CREATE OR REPLACE FUNCTION delete_user_account()
RETURNS JSON AS $$
DECLARE
  current_user_id UUID;
  current_user_email TEXT;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  SELECT email INTO current_user_email FROM users WHERE id = current_user_id;
  
  DELETE FROM team_members WHERE user_id = current_user_id;
  DELETE FROM user_job_titles WHERE user_id = current_user_id;
  DELETE FROM user_permissions WHERE user_id = current_user_id;
  DELETE FROM user_sessions WHERE user_id = current_user_id;
  DELETE FROM color_swatches WHERE user_id = current_user_id;
  DELETE FROM notifications WHERE user_id = current_user_id;
  DELETE FROM users WHERE id = current_user_id;
  DELETE FROM auth.users WHERE id = current_user_id;
  
  RETURN json_build_object('success', true, 'message', 'Account deleted');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION delete_user_account() TO authenticated;

-- Admin remove user
CREATE OR REPLACE FUNCTION admin_remove_user(p_user_email TEXT)
RETURNS JSON AS $$
DECLARE
  current_user_id UUID;
  current_org_id UUID;
  target_user_id UUID;
  target_org_id UUID;
  normalized_email TEXT;
BEGIN
  current_user_id := auth.uid();
  normalized_email := LOWER(TRIM(p_user_email));
  
  SELECT org_id INTO current_org_id FROM users WHERE id = current_user_id;
  
  IF current_org_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'You are not a member of any organization');
  END IF;
  
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can remove users');
  END IF;
  
  SELECT id, org_id INTO target_user_id, target_org_id
  FROM users WHERE LOWER(email) = normalized_email;
  
  IF target_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;
  
  IF target_org_id != current_org_id THEN
    RETURN json_build_object('success', false, 'error', 'User is not in your organization');
  END IF;
  
  IF target_user_id = current_user_id THEN
    RETURN json_build_object('success', false, 'error', 'You cannot remove yourself');
  END IF;
  
  DELETE FROM team_members WHERE user_id = target_user_id;
  DELETE FROM user_job_titles WHERE user_id = target_user_id;
  DELETE FROM user_permissions WHERE user_id = target_user_id;
  DELETE FROM user_sessions WHERE user_id = target_user_id;
  DELETE FROM color_swatches WHERE user_id = target_user_id;
  DELETE FROM notifications WHERE user_id = target_user_id;
  DELETE FROM users WHERE id = target_user_id;
  DELETE FROM auth.users WHERE id = target_user_id;
  
  RETURN json_build_object('success', true, 'message', 'User removed from organization and account deleted');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION admin_remove_user(TEXT) TO authenticated;

-- Use admin recovery code
CREATE OR REPLACE FUNCTION use_admin_recovery_code(
  p_code TEXT,
  p_ip_address TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_user_id UUID;
  v_user_org_id UUID;
  v_code_hash TEXT;
  v_recovery RECORD;
  v_admin_team_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  SELECT org_id INTO v_user_org_id FROM users WHERE id = v_user_id;
  
  IF v_user_org_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User has no organization');
  END IF;
  
  v_code_hash := encode(digest(p_code, 'sha256'), 'hex');
  
  SELECT * INTO v_recovery
  FROM admin_recovery_codes
  WHERE org_id = v_user_org_id
    AND code_hash = v_code_hash
    AND is_used = false
    AND is_revoked = false
    AND expires_at > NOW()
  LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Invalid, expired, or already used recovery code');
  END IF;
  
  UPDATE admin_recovery_codes
  SET is_used = true, used_by = v_user_id, used_at = NOW(), used_from_ip = p_ip_address
  WHERE id = v_recovery.id;
  
  SELECT id INTO v_admin_team_id
  FROM teams WHERE org_id = v_user_org_id AND name = 'Administrators';
  
  IF v_admin_team_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Administrators team not found');
  END IF;
  
  INSERT INTO team_members (team_id, user_id, added_by)
  VALUES (v_admin_team_id, v_user_id, v_user_id)
  ON CONFLICT (team_id, user_id) DO NOTHING;
  
  RETURN json_build_object('success', true, 'message', 'You have been granted admin access');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION use_admin_recovery_code TO authenticated;

-- Update user avatar
CREATE OR REPLACE FUNCTION update_user_avatar(
  p_custom_avatar_url TEXT DEFAULT NULL,
  p_avatar_storage_path TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  UPDATE users
  SET custom_avatar_url = CASE 
      WHEN p_custom_avatar_url = '' THEN NULL 
      WHEN p_custom_avatar_url IS NOT NULL THEN p_custom_avatar_url 
      ELSE custom_avatar_url 
    END
  WHERE id = current_user_id;
  
  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION update_user_avatar TO authenticated;

-- Updated at column function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- RLS FOR CORE TABLES
-- ===========================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their organization" ON organizations;
DROP POLICY IF EXISTS "Authenticated users can view organizations" ON organizations;
CREATE POLICY "Authenticated users can view organizations"
  ON organizations FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can update their organization" ON organizations;
CREATE POLICY "Admins can update their organization"
  ON organizations FOR UPDATE
  TO authenticated
  USING (id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin())
  WITH CHECK (id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Users can view org members" ON users;
DROP POLICY IF EXISTS "Authenticated users can view users" ON users;
CREATE POLICY "Authenticated users can view users"
  ON users FOR SELECT
  TO authenticated
  USING (true);

-- THE ANCHOR EVERY OTHER GATE IN THIS SCHEMA RESTS ON
--
-- users.org_id and users.role are what is_org_admin(), require_org_member(),
-- require_file_access() and every membership subquery below resolve against.
-- Until this release the self-update policy was USING (id = auth.uid()) with no
-- WITH CHECK, and a policy with no WITH CHECK reuses its USING expression as the
-- check - which tests the *new* row's id, not its org_id or role. One
-- PATCH /rest/v1/users?id=eq.<self> {"org_id": "<other org>", "role": "admin"}
-- returned 200 and moved a viewer into another tenant as its administrator, so
-- every gate schemas 89-94 added was answered honestly against a row the caller
-- had just rewritten. The BEFORE UPDATE trigger above (auto_set_user_org_id) is
-- a no-op stub and caught nothing.
--
-- WHY A WITH CHECK AND NOT A COLUMN GRANT
--
-- A column-level GRANT UPDATE is issued to a *role*, and both policies here
-- apply to the same role, authenticated. A grant therefore cannot tell a user
-- editing their own row from an admin editing a member's - and the admin path
-- legitimately writes role (src/lib/supabase/teams.ts:37), so granting role to
-- keep team management working hands the escalation straight back. A WITH CHECK
-- is per-policy, which is exactly the distinction that is needed: role and
-- org_id are pinned on the self policy and left alone on the admin policy.
--
-- The subqueries read the caller's row under the statement snapshot. Rows
-- written by the current command are not visible to subqueries within that same
-- command, so these observe the pre-update values and cannot be satisfied by
-- the write they are checking.
--
-- IS NOT DISTINCT FROM rather than =, because org_id is nullable: an account
-- that has signed up and not yet joined an organization has org_id NULL, and
-- `NULL = NULL` is NULL, which fails the check and would lock that account out
-- of its own last_online write. This is the same NULL-unsafety the nine
-- membership tests schema 91 corrected, on the other side of the comparison.
--
-- TO authenticated: these were the only two policies in this block without a
-- role qualifier - the three organizations and users SELECT/UPDATE policies
-- above all carry it - so they applied to PUBLIC, which includes anon. Not
-- exploitable while auth.uid() is NULL for anon, but the bootstrap grants anon
-- explicitly and schema 90 exists because a default grant nobody had named
-- turned out to be load-bearing.
DROP POLICY IF EXISTS "Users can update their own profile" ON users;
CREATE POLICY "Users can update their own profile"
  ON users FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role   IS NOT DISTINCT FROM (SELECT u.role   FROM users u WHERE u.id = auth.uid())
    AND org_id IS NOT DISTINCT FROM (SELECT u.org_id FROM users u WHERE u.id = auth.uid())
  );

-- EXAMINED AND SOUND - DO NOT WRITE A STRICTER CHECK HERE
--
-- This policy had no WITH CHECK either, and that is not a second hole. Nothing
-- in supabase/ is AS RESTRICTIVE, so both UPDATE policies on users are
-- permissive and PostgreSQL ORs them on the WITH CHECK side as well as the
-- USING side. The effective check on the new row is:
--
--   (NEW.id = auth.uid() AND role and org_id unchanged)
--   OR (NEW.org_id IN (caller's org) AND is_org_admin())
--
-- An admin moving *another* user to a foreign org fails branch 1 (the id is the
-- victim's) and branch 2 (the foreign org is not in the caller's org set), and
-- is refused. An admin moving *themselves* passes through branch 1 - which is
-- the defect the policy above now closes, not a defect in this one.
--
-- The check below is written out rather than left implicit, matching "Admins
-- can update their organization" above, which spells its check out. It restates
-- the default and is therefore semantically a no-op; it is here so that the
-- next reader does not have to reconstruct the permissive-OR argument to be
-- sure of it. Anything *stricter* breaks this policy's entire purpose: pinning
-- role here breaks updateUserRole (src/lib/supabase/teams.ts:14-44), which is
-- the one thing it exists to allow.
--
-- Two known gaps that are product decisions and not cross-tenant holes, left
-- for the owner rather than fixed here: there is no last-admin protection, so
-- an admin can demote the only other admin and strand the organization; and
-- there is no column restriction, so an admin can rewrite a member's email or
-- id and desync the row from auth.users.
--
-- Separately: addUserToOrg (teams.ts:90, insert at :121) writes a user whose org_id is
-- NULL, and `NULL IN (SELECT ...)` is NULL rather than true, so this policy
-- already refuses it. Adding a member by email over the table path is broken
-- today, independently of this release. Fixing it means a SECURITY DEFINER RPC
-- as the invite path already uses, not a looser USING clause here.
DROP POLICY IF EXISTS "Admins can update org users" ON users;
CREATE POLICY "Admins can update org users"
  ON users FOR UPDATE
  TO authenticated
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin())
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- ===========================================
-- MODULE DEFAULTS FUNCTIONS
-- ===========================================

-- Drop existing functions first (in case signatures changed)
DROP FUNCTION IF EXISTS get_org_module_defaults(UUID) CASCADE;
DROP FUNCTION IF EXISTS set_org_module_defaults(UUID, JSONB, JSONB, JSONB, JSONB) CASCADE;
DROP FUNCTION IF EXISTS set_org_module_defaults(UUID, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) CASCADE;
DROP FUNCTION IF EXISTS force_org_module_defaults(UUID, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) CASCADE;
DROP FUNCTION IF EXISTS get_team_module_defaults(UUID) CASCADE;
DROP FUNCTION IF EXISTS set_team_module_defaults(UUID, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) CASCADE;
DROP FUNCTION IF EXISTS clear_team_module_defaults(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_user_module_defaults() CASCADE;

-- Get organization module defaults
--
-- THE MEMBERSHIP TEST IS NOT HAND-WRITTEN ANY MORE
--
-- This and nine other RPCs did their own:
--
--   SELECT org_id INTO v_user_org_id FROM users WHERE id = auth.uid();
--   IF v_user_org_id IS NULL OR v_user_org_id != p_org_id THEN ...
--
-- which is correct - NULL-safe, and check_null_unsafe_org_gates() has nothing
-- to say about it. It is gone anyway, because its existence was the reason
-- check_org_gates() counted a bare `auth.uid()` as evidence that a function was
-- gated, and that accommodation let a function with no authorization at all be
-- certified and stamped. A convention accommodated is a convention abandoned.
--
-- require_org_member() admits the same callers and refuses a NULL p_org_id
-- rather than proceeding against no organization, which the version above did.
CREATE OR REPLACE FUNCTION get_org_module_defaults(p_org_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_defaults JSONB;
BEGIN
  PERFORM require_org_member(p_org_id);

  SELECT module_defaults INTO v_defaults
  FROM organizations WHERE id = p_org_id;
  
  RETURN v_defaults;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_org_module_defaults(UUID) TO authenticated;

-- Set organization module defaults (admins only)
CREATE OR REPLACE FUNCTION set_org_module_defaults(
  p_org_id UUID,
  p_enabled_modules JSONB,
  p_enabled_groups JSONB,
  p_module_order JSONB,
  p_dividers JSONB,
  p_module_parents JSONB DEFAULT NULL,
  p_module_icon_colors JSONB DEFAULT NULL,
  p_custom_groups JSONB DEFAULT NULL
)
RETURNS JSON AS $$
BEGIN
  -- is_org_member rather than require_org_member: this one answers with a
  -- payload instead of raising, and the two have to keep saying the same thing.
  IF NOT is_org_member(p_org_id) THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;

  -- Verify user is admin
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can set org defaults');
  END IF;
  
  -- Update module defaults
  UPDATE organizations
  SET module_defaults = jsonb_build_object(
    'enabled_modules', p_enabled_modules,
    'enabled_groups', p_enabled_groups,
    'module_order', p_module_order,
    'dividers', p_dividers,
    'module_parents', COALESCE(p_module_parents, '{}'::jsonb),
    'module_icon_colors', COALESCE(p_module_icon_colors, '{}'::jsonb),
    'custom_groups', COALESCE(p_custom_groups, '[]'::jsonb)
  )
  WHERE id = p_org_id;
  
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION set_org_module_defaults(UUID, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) TO authenticated;

-- Force organization module defaults to all users (admins only)
-- This sets both the defaults AND the forced_at timestamp
CREATE OR REPLACE FUNCTION force_org_module_defaults(
  p_org_id UUID,
  p_enabled_modules JSONB,
  p_enabled_groups JSONB,
  p_module_order JSONB,
  p_dividers JSONB,
  p_module_parents JSONB DEFAULT NULL,
  p_module_icon_colors JSONB DEFAULT NULL,
  p_custom_groups JSONB DEFAULT NULL
)
RETURNS JSON AS $$
BEGIN
  IF NOT is_org_member(p_org_id) THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;

  -- Verify user is admin
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can force module defaults');
  END IF;
  
  -- Update module defaults AND set forced_at timestamp
  UPDATE organizations
  SET module_defaults = jsonb_build_object(
    'enabled_modules', p_enabled_modules,
    'enabled_groups', p_enabled_groups,
    'module_order', p_module_order,
    'dividers', p_dividers,
    'module_parents', COALESCE(p_module_parents, '{}'::jsonb),
    'module_icon_colors', COALESCE(p_module_icon_colors, '{}'::jsonb),
    'custom_groups', COALESCE(p_custom_groups, '[]'::jsonb)
  ),
  module_defaults_forced_at = NOW()
  WHERE id = p_org_id;
  
  RETURN json_build_object('success', true, 'forced_at', NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION force_org_module_defaults(UUID, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) TO authenticated;

-- Get team module defaults
CREATE OR REPLACE FUNCTION get_team_module_defaults(p_team_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_user_org_id UUID;
  v_team_org_id UUID;
  v_defaults JSONB;
BEGIN
  -- Get user's org
  SELECT org_id INTO v_user_org_id FROM users WHERE id = auth.uid();
  
  -- Get team's org
  SELECT org_id INTO v_team_org_id FROM teams WHERE id = p_team_id;
  
  -- Verify user belongs to the same org as the team
  IF v_user_org_id IS NULL OR v_team_org_id IS NULL OR v_user_org_id != v_team_org_id THEN
    RAISE EXCEPTION 'Not authorized to access this team';
  END IF;
  
  SELECT module_defaults INTO v_defaults
  FROM teams WHERE id = p_team_id;
  
  RETURN v_defaults;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_team_module_defaults(UUID) TO authenticated;

-- Set team module defaults (admins only)
CREATE OR REPLACE FUNCTION set_team_module_defaults(
  p_team_id UUID,
  p_enabled_modules JSONB,
  p_enabled_groups JSONB,
  p_module_order JSONB,
  p_dividers JSONB,
  p_module_parents JSONB DEFAULT NULL,
  p_module_icon_colors JSONB DEFAULT NULL,
  p_custom_groups JSONB DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_user_org_id UUID;
  v_team_org_id UUID;
BEGIN
  -- Get user's org
  SELECT org_id INTO v_user_org_id FROM users WHERE id = auth.uid();
  
  -- Get team's org
  SELECT org_id INTO v_team_org_id FROM teams WHERE id = p_team_id;
  
  -- Verify user belongs to the same org as the team
  IF v_user_org_id IS NULL OR v_team_org_id IS NULL OR v_user_org_id != v_team_org_id THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;
  
  -- Verify user is admin
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can set team defaults');
  END IF;
  
  -- Update team module defaults
  UPDATE teams
  SET module_defaults = jsonb_build_object(
    'enabled_modules', p_enabled_modules,
    'enabled_groups', p_enabled_groups,
    'module_order', p_module_order,
    'dividers', p_dividers,
    'module_parents', COALESCE(p_module_parents, '{}'::jsonb),
    'module_icon_colors', COALESCE(p_module_icon_colors, '{}'::jsonb),
    'custom_groups', COALESCE(p_custom_groups, '[]'::jsonb)
  )
  WHERE id = p_team_id;
  
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION set_team_module_defaults(UUID, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) TO authenticated;

-- Clear team module defaults (admins only)
CREATE OR REPLACE FUNCTION clear_team_module_defaults(p_team_id UUID)
RETURNS JSON AS $$
DECLARE
  v_user_org_id UUID;
  v_team_org_id UUID;
BEGIN
  -- Get user's org
  SELECT org_id INTO v_user_org_id FROM users WHERE id = auth.uid();
  
  -- Get team's org
  SELECT org_id INTO v_team_org_id FROM teams WHERE id = p_team_id;
  
  -- Verify user belongs to the same org as the team
  IF v_user_org_id IS NULL OR v_team_org_id IS NULL OR v_user_org_id != v_team_org_id THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;
  
  -- Verify user is admin
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can clear team defaults');
  END IF;
  
  -- Clear team module defaults
  UPDATE teams
  SET module_defaults = NULL
  WHERE id = p_team_id;
  
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION clear_team_module_defaults(UUID) TO authenticated;

-- Get user module defaults (from team or org, in priority order)
CREATE OR REPLACE FUNCTION get_user_module_defaults()
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_user_org_id UUID;
  v_defaults JSONB;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Get user's org
  SELECT org_id INTO v_user_org_id FROM users WHERE id = v_user_id;
  
  IF v_user_org_id IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- First, check if user is in a team with module defaults
  SELECT t.module_defaults INTO v_defaults
  FROM team_members tm
  JOIN teams t ON t.id = tm.team_id
  WHERE tm.user_id = v_user_id
    AND t.org_id = v_user_org_id
    AND t.module_defaults IS NOT NULL
  ORDER BY t.name
  LIMIT 1;
  
  -- If no team defaults, fall back to org defaults
  IF v_defaults IS NULL THEN
    SELECT module_defaults INTO v_defaults
    FROM organizations WHERE id = v_user_org_id;
  END IF;
  
  RETURN v_defaults;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_user_module_defaults() TO authenticated;

-- ===========================================
-- MODULE ACCESS FUNCTIONS
-- ===========================================
-- See the module_access table above for the allowlist semantics: no rows for a
-- module means everyone can see it.

-- Deliberately no DROP for user_can_access_module: the customers module's RLS
-- policies depend on it, and a DROP ... CASCADE here would silently delete
-- those policies when core.sql is re-run on an existing install, leaving the
-- customer tables unreadable. CREATE OR REPLACE is enough while the signature
-- is stable; a signature change needs the dependent policies dropped first.
DROP FUNCTION IF EXISTS get_denied_modules() CASCADE;
DROP FUNCTION IF EXISTS get_module_access_config() CASCADE;
DROP FUNCTION IF EXISTS set_module_access(TEXT, UUID[], UUID[]) CASCADE;

-- Can this user see the given module? Safe to call from RLS policies.
CREATE OR REPLACE FUNCTION user_can_access_module(
  p_module_id TEXT,
  p_user_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());

  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT org_id INTO v_org_id FROM users WHERE id = v_user_id;

  IF v_org_id IS NULL THEN
    RETURN false;
  END IF;

  IF is_org_admin(v_user_id) THEN
    RETURN true;
  END IF;

  -- Unrestricted until an admin adds a subject
  IF NOT EXISTS (
    SELECT 1 FROM module_access ma
    WHERE ma.org_id = v_org_id AND ma.module_id = p_module_id
  ) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM module_access ma
    WHERE ma.org_id = v_org_id
      AND ma.module_id = p_module_id
      AND ma.user_id = v_user_id
  ) OR EXISTS (
    SELECT 1 FROM module_access ma
    JOIN team_members tm ON tm.team_id = ma.team_id
    WHERE ma.org_id = v_org_id
      AND ma.module_id = p_module_id
      AND tm.user_id = v_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION user_can_access_module(TEXT, UUID) TO authenticated;

-- Modules the caller is restricted out of. Returns the denied set rather than
-- the allowed set because the open default makes it empty for almost everyone.
CREATE OR REPLACE FUNCTION get_denied_modules()
RETURNS TEXT[] AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_denied TEXT[];
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN ARRAY[]::TEXT[];
  END IF;

  SELECT org_id INTO v_org_id FROM users WHERE id = v_user_id;

  IF v_org_id IS NULL OR is_org_admin(v_user_id) THEN
    RETURN ARRAY[]::TEXT[];
  END IF;

  SELECT COALESCE(array_agg(restricted.module_id), ARRAY[]::TEXT[])
  INTO v_denied
  FROM (
    SELECT DISTINCT ma.module_id
    FROM module_access ma
    WHERE ma.org_id = v_org_id
  ) restricted
  WHERE NOT EXISTS (
    SELECT 1
    FROM module_access allowed
    LEFT JOIN team_members tm
      ON tm.team_id = allowed.team_id AND tm.user_id = v_user_id
    WHERE allowed.org_id = v_org_id
      AND allowed.module_id = restricted.module_id
      AND (allowed.user_id = v_user_id OR tm.user_id IS NOT NULL)
  );

  RETURN v_denied;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION get_denied_modules() TO authenticated;

-- Full allowlist for the admin UI
CREATE OR REPLACE FUNCTION get_module_access_config()
RETURNS TABLE (
  module_id TEXT,
  team_id UUID,
  user_id UUID
) AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT org_id INTO v_org_id FROM users WHERE id = auth.uid();

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF NOT is_org_admin() THEN
    RAISE EXCEPTION 'Only admins can view module access';
  END IF;

  RETURN QUERY
  SELECT ma.module_id, ma.team_id, ma.user_id
  FROM module_access ma
  WHERE ma.org_id = v_org_id
  ORDER BY ma.module_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_module_access_config() TO authenticated;

-- Replace the allowlist for one module (admins only).
-- Passing two empty arrays clears it, restoring the module to everyone.
CREATE OR REPLACE FUNCTION set_module_access(
  p_module_id TEXT,
  p_team_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_user_ids UUID[] DEFAULT ARRAY[]::UUID[]
) RETURNS JSON AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
BEGIN
  v_user_id := auth.uid();
  SELECT org_id INTO v_org_id FROM users WHERE id = v_user_id;

  IF v_org_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;

  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can set module access');
  END IF;

  IF p_module_id IS NULL OR p_module_id = '' THEN
    RETURN json_build_object('success', false, 'error', 'Module is required');
  END IF;

  DELETE FROM module_access
  WHERE org_id = v_org_id AND module_id = p_module_id;

  -- Subqueries scope the insert to the caller's org, so ids from another org
  -- are dropped instead of silently granting cross-org access.
  INSERT INTO module_access (org_id, module_id, team_id, granted_by)
  SELECT v_org_id, p_module_id, t.id, v_user_id
  FROM teams t
  WHERE t.org_id = v_org_id
    AND t.id = ANY(COALESCE(p_team_ids, ARRAY[]::UUID[]));

  INSERT INTO module_access (org_id, module_id, user_id, granted_by)
  SELECT v_org_id, p_module_id, u.id, v_user_id
  FROM users u
  WHERE u.org_id = v_org_id
    AND u.id = ANY(COALESCE(p_user_ids, ARRAY[]::UUID[]));

  RETURN json_build_object(
    'success', true,
    'restricted', EXISTS (
      SELECT 1 FROM module_access
      WHERE org_id = v_org_id AND module_id = p_module_id
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION set_module_access(TEXT, UUID[], UUID[]) TO authenticated;

-- Drop permission rows for modules removed from the app, so the permissions
-- matrix stops offering resources that no longer exist.
DELETE FROM team_permissions WHERE resource IN (
  'module:boms', 'module:purchase-requests', 'module:purchase-orders', 'module:invoices',
  'module:shipping', 'module:receiving', 'module:manufacturing-orders', 'module:travellers',
  'module:work-instructions', 'module:production-schedule', 'module:routings',
  'module:work-centers', 'module:process-flows', 'module:equipment',
  'module:yield-tracking', 'module:error-codes', 'module:downtime', 'module:oee',
  'module:scrap-tracking', 'module:fai', 'module:ncr', 'module:imr', 'module:scar',
  'module:capa', 'module:rma', 'module:certificates', 'module:calibration',
  'module:quality-templates', 'module:accounts-payable', 'module:accounts-receivable',
  'module:general-ledger', 'module:cost-tracking', 'module:budgets'
);

DELETE FROM user_permissions WHERE resource IN (
  'module:boms', 'module:purchase-requests', 'module:purchase-orders', 'module:invoices',
  'module:shipping', 'module:receiving', 'module:manufacturing-orders', 'module:travellers',
  'module:work-instructions', 'module:production-schedule', 'module:routings',
  'module:work-centers', 'module:process-flows', 'module:equipment',
  'module:yield-tracking', 'module:error-codes', 'module:downtime', 'module:oee',
  'module:scrap-tracking', 'module:fai', 'module:ncr', 'module:imr', 'module:scar',
  'module:capa', 'module:rma', 'module:certificates', 'module:calibration',
  'module:quality-templates', 'module:accounts-payable', 'module:accounts-receivable',
  'module:general-ledger', 'module:cost-tracking', 'module:budgets'
);

-- ===========================================
-- COLUMN DEFAULTS FUNCTIONS
-- ===========================================

DROP FUNCTION IF EXISTS get_org_column_defaults(UUID) CASCADE;
DROP FUNCTION IF EXISTS set_org_column_defaults(UUID, JSONB) CASCADE;
DROP FUNCTION IF EXISTS force_org_column_defaults(UUID, JSONB) CASCADE;
DROP FUNCTION IF EXISTS get_user_column_defaults() CASCADE;
DROP FUNCTION IF EXISTS set_user_column_defaults(JSONB) CASCADE;

-- Get organization column defaults
CREATE OR REPLACE FUNCTION get_org_column_defaults(p_org_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_defaults JSONB;
BEGIN
  PERFORM require_org_member(p_org_id);

  SELECT COALESCE(settings->'column_defaults', '[]'::jsonb)
  INTO v_defaults
  FROM organizations WHERE id = p_org_id;
  
  RETURN v_defaults;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_org_column_defaults(UUID) TO authenticated;

-- Set organization column defaults (admins only)
CREATE OR REPLACE FUNCTION set_org_column_defaults(p_org_id UUID, p_column_defaults JSONB)
RETURNS JSON AS $$
BEGIN
  IF NOT is_org_member(p_org_id) THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;

  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can set column defaults');
  END IF;
  
  UPDATE organizations
  SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{column_defaults}', p_column_defaults)
  WHERE id = p_org_id;
  
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION set_org_column_defaults(UUID, JSONB) TO authenticated;

-- Force organization column defaults to all users (admins only)
-- Sets both the defaults AND the forced_at timestamp
CREATE OR REPLACE FUNCTION force_org_column_defaults(p_org_id UUID, p_column_defaults JSONB)
RETURNS JSON AS $$
BEGIN
  IF NOT is_org_member(p_org_id) THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;

  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can force column defaults');
  END IF;
  
  UPDATE organizations
  SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{column_defaults}', p_column_defaults),
      column_defaults_forced_at = NOW()
  WHERE id = p_org_id;
  
  RETURN json_build_object('success', true, 'forced_at', NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION force_org_column_defaults(UUID, JSONB) TO authenticated;

-- Save user's personal column defaults (any authenticated user)
CREATE OR REPLACE FUNCTION set_user_column_defaults(p_column_defaults JSONB)
RETURNS JSON AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  UPDATE users
  SET column_defaults = p_column_defaults
  WHERE id = auth.uid();
  
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION set_user_column_defaults(JSONB) TO authenticated;

-- Get user's personal column defaults
CREATE OR REPLACE FUNCTION get_user_column_defaults()
RETURNS JSONB AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  
  RETURN (SELECT column_defaults FROM users WHERE id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_user_column_defaults() TO authenticated;

-- ===========================================
-- ENABLE REALTIME
-- ===========================================

ALTER TABLE teams REPLICA IDENTITY FULL;
ALTER TABLE team_members REPLICA IDENTITY FULL;
ALTER TABLE team_permissions REPLICA IDENTITY FULL;
ALTER TABLE notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE teams; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE team_members; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE team_permissions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE notifications; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ===========================================
-- END OF CORE SCHEMA
-- ===========================================

-- Move every column default off uuid-ossp.
--
-- New tables in this release default to gen_random_uuid(), but CREATE TABLE IF
-- NOT EXISTS does nothing to a table that already exists, so a database
-- installed before this release still has ~93 columns whose default calls
-- uuid_generate_v4(). While any of them do, the extension cannot be dropped and
-- whatever it put in public stays on the advisory list for ever.
--
-- Rewriting the default is a catalogue change - no row is touched and no value
-- already generated changes - so it is safe to run on a live database and safe
-- to run again. It is deliberately narrow: only defaults that are exactly a
-- call to uuid_generate_v4() with no arguments are rewritten, and only on
-- ordinary tables in public.
CREATE OR REPLACE FUNCTION migrate_uuid_defaults()
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name, a.attname AS column_name
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT a.attisdropped
      AND pg_get_expr(d.adbin, d.adrelid) ~ '^\(?\s*(\w+\s*\.\s*)?uuid_generate_v4\(\)\s*\)?$'
    ORDER BY 1, 2
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT gen_random_uuid()',
                   r.table_name, r.column_name);
    v_count := v_count + 1;
  END LOOP;

  IF v_count > 0 THEN
    RAISE NOTICE 'Moved % column default(s) from uuid_generate_v4() to gen_random_uuid(). uuid-ossp is no longer required by BluePLM.', v_count;
  END IF;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION migrate_uuid_defaults() FROM PUBLIC, anon, authenticated;

SELECT migrate_uuid_defaults();

SELECT enforce_anon_execute_posture();

-- Ask to be verified and stamped, in case this is the last file of the run.
--
-- On a fresh install it is the first, so the answer is no: the modules are not
-- there yet, and core.sql cannot honestly say anything about them. Apply the
-- modules and the last of them records the version. On an upgrade where only
-- this file changed, core.sql *is* the last file and stamps here.
--
-- Either way the number itself lives in one place, schema_release_version()
-- above, which is the line to bump when the release moves. See
-- try_stamp_schema() for why asking is safe when stamping was not.
DO $$
BEGIN
  RAISE NOTICE 'Core schema installed successfully';
  PERFORM try_stamp_schema();
END $$;
