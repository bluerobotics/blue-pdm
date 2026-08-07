-- Save and restore a policy or a function, by reading it back out of the
-- catalogue rather than by keeping a copy of its text here.
--
-- WHY NOT JUST WRITE THE SCHEMA-95 TEXT INTO A RESTORE SCRIPT
--
-- Because then the harness carries a second copy of the thing under test, and
-- the two drift. A control that reverts a policy, runs an assertion, and then
-- reinstalls a *stale* copy of the policy is worse than no control: every later
-- assertion in the run is measuring the harness's idea of schema 95 instead of
-- Agent A's. The suite would keep passing while the schema moved out from under
-- it - which is the exact failure this whole exercise is about, committed by
-- the tooling one level up.
--
-- Snapshotting the live definition has neither problem. What is put back is
-- byte-for-byte what was found, whatever release it came from, and a control
-- written today keeps working against schema 96 without being edited.
--
-- EVERYTHING HERE LIVES IN ITS OWN SCHEMA
--
-- A table in public with no RLS is exactly what emergency-lockdown.sql and
-- verify-schema.sql are built to complain about, and they would be right to:
-- the harness would be introducing the defect it exists to detect. Both look at
-- public only, and PostgREST is configured with PGRST_DB_SCHEMAS=public, so
-- nothing in here is reachable over the API or visible to a check.

CREATE SCHEMA IF NOT EXISTS harness;
REVOKE ALL ON SCHEMA harness FROM PUBLIC;

-- A real table rather than a temp one: each control statement goes through its
-- own psql invocation, and a temp table would not survive between them.
CREATE TABLE IF NOT EXISTS harness.object_snapshot (
  key      TEXT PRIMARY KEY,
  ddl      TEXT NOT NULL,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reconstruct a CREATE POLICY statement from pg_policies.
--
-- pg_policies renders qual and with_check through pg_get_expr, so what comes
-- back is the parsed and re-printed expression rather than the source text -
-- schema-qualified, parenthesised, casts made explicit. That is not a
-- limitation: an expression that survives a parse/deparse round trip is the
-- same expression, and PostgreSQL itself is the only authority on that.
CREATE OR REPLACE FUNCTION harness.policy_ddl(p_table TEXT, p_policy TEXT)
RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT format(
           'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
           pol.policyname, pol.schemaname, pol.tablename,
           pol.permissive, pol.cmd,
           array_to_string(pol.roles, ', '),
           CASE WHEN pol.qual       IS NOT NULL THEN ' USING (' || pol.qual || ')' ELSE '' END,
           CASE WHEN pol.with_check IS NOT NULL THEN ' WITH CHECK (' || pol.with_check || ')' ELSE '' END)
    FROM pg_policies pol
   WHERE pol.schemaname = 'public'
     AND pol.tablename  = p_table
     AND pol.policyname = p_policy;
$$;

-- Refuses rather than storing nothing when the policy is not there. A restore
-- that silently put back an empty string would leave the table with no policy
-- at all, and every later assertion would read as a refusal.
CREATE OR REPLACE FUNCTION harness.snapshot_policy(p_table TEXT, p_policy TEXT)
RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE v_ddl TEXT;
BEGIN
  v_ddl := harness.policy_ddl(p_table, p_policy);
  IF v_ddl IS NULL THEN
    RAISE EXCEPTION 'no policy % on public.% to snapshot', p_policy, p_table;
  END IF;
  INSERT INTO harness.object_snapshot (key, ddl)
  VALUES ('policy:' || p_table || ':' || p_policy, v_ddl)
  ON CONFLICT (key) DO UPDATE SET ddl = EXCLUDED.ddl, taken_at = NOW();
  RETURN v_ddl;
END;
$$;

CREATE OR REPLACE FUNCTION harness.restore_policy(p_table TEXT, p_policy TEXT)
RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE v_ddl TEXT;
BEGIN
  SELECT s.ddl INTO v_ddl FROM harness.object_snapshot s
   WHERE s.key = 'policy:' || p_table || ':' || p_policy;
  IF v_ddl IS NULL THEN
    RAISE EXCEPTION 'no snapshot of % on public.% to restore', p_policy, p_table;
  END IF;
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p_policy, p_table);
  EXECUTE v_ddl;
  RETURN v_ddl;
END;
$$;

-- The same idea for a function. pg_get_functiondef emits a complete
-- CREATE OR REPLACE, so restoring is one EXECUTE and no reconstruction.
CREATE OR REPLACE FUNCTION harness.snapshot_function(p_signature TEXT)
RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  v_oid regprocedure;
  v_ddl TEXT;
BEGIN
  v_oid := to_regprocedure(p_signature);
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'no function % to snapshot', p_signature;
  END IF;
  v_ddl := pg_get_functiondef(v_oid);
  INSERT INTO harness.object_snapshot (key, ddl)
  VALUES ('function:' || p_signature, v_ddl)
  ON CONFLICT (key) DO UPDATE SET ddl = EXCLUDED.ddl, taken_at = NOW();
  RETURN v_ddl;
END;
$$;

-- pg_get_functiondef carries the body, not the ACL. CREATE OR REPLACE preserves
-- the privileges of a function that already exists, so as long as a mutant is
-- installed with CREATE OR REPLACE rather than DROP + CREATE, the module's
-- `REVOKE ALL ON FUNCTION may_review_gate(...) FROM PUBLIC, anon, authenticated`
-- survives both the mutation and the restore. policy-controls.ps1 asserts that
-- rather than trusting it.
CREATE OR REPLACE FUNCTION harness.restore_function(p_signature TEXT)
RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE v_ddl TEXT;
BEGIN
  SELECT s.ddl INTO v_ddl FROM harness.object_snapshot s
   WHERE s.key = 'function:' || p_signature;
  IF v_ddl IS NULL THEN
    RAISE EXCEPTION 'no snapshot of % to restore', p_signature;
  END IF;
  EXECUTE v_ddl;
  RETURN v_ddl;
END;
$$;
