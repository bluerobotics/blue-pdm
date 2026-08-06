-- Runs as supabase_admin. The parts of a real project's posture that live
-- outside the three role migrations but that BluePLM's schema depends on.

-- From Supabase's 00000000000003-post-setup.sql, verbatim in effect. BluePLM no
-- longer needs anything from the extensions schema - gen_random_uuid() is
-- built in - but the search_path is part of the posture being reproduced, not a
-- convenience for the schema under test, so it stays as the project has it.
ALTER ROLE supabase_admin SET search_path TO "$user", public, auth, extensions;
ALTER ROLE postgres SET search_path TO "$user", public, extensions;
ALTER ROLE authenticator SET search_path TO "$user", public, extensions;

-- Supabase's bundled auth-schema.sql still carries the 2017 definitions, which
-- read the per-claim GUCs that only old PostgREST sets. A current project has
-- the claims-object form. Use it, with the legacy GUC kept as a fallback, so a
-- NULL auth.uid() in a test is a fact about the code under test and not an
-- artefact of the container.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.email', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.email(), auth.jwt()
  TO anon, authenticated, service_role, postgres;

-- core.sql owns a trigger on auth.users (`on_auth_user_created`), and DROP
-- TRIGGER requires ownership of the table. Supabase granted postgres membership
-- in supabase_auth_admin for exactly this reason in
-- 20220609081115_grant-supabase-auth-admin-and-supabase-storage-admin-to-postgres.sql.
--
-- This is the one grant here that is not straight from an upstream migration in
-- its current form, and it is deliberately scoped: supabase_auth_admin owns the
-- auth schema and nothing in public, holds no default-privilege entry, and is
-- not a superuser. It cannot make any check in this release pass that would
-- otherwise fail - all of those turn on `postgres` vs `supabase_admin` in schema
-- public. 90-assert-harness.sql asserts that separation directly.
GRANT supabase_auth_admin TO postgres;

-- On a real project the SQL editor connects as postgres and creates the whole
-- BluePLM schema in public, so postgres must be able to. Supabase's bundled
-- initial-schema.sql grants only USAGE, because on projects predating Postgres
-- 15 the CREATE came from PUBLIC's built-in grant on the public schema, which
-- 15 removed. Granting it explicitly reproduces the end state without making
-- postgres the schema owner: objects created by core.sql come out owned by
-- postgres, which is what they are on the owner's database.
GRANT CREATE ON SCHEMA public TO postgres;

-- PostgREST logs in as authenticator.
ALTER ROLE authenticator LOGIN PASSWORD 'authenticator';
