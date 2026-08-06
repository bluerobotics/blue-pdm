-- Runs as supabase_admin (the initdb bootstrap superuser).
--
-- `postgres` is created as a superuser here and demoted later by Supabase's own
-- 10000000000000_demote-postgres.sql. The order matters for more than realism:
-- the unqualified ALTER DEFAULT PRIVILEGES statements in Supabase's
-- initial-schema.sql are attributed to whoever runs them, and they must be
-- attributed to `postgres` for pg_default_acl to end up with the two rows a real
-- project has (one for postgres, one for supabase_admin).
CREATE ROLE postgres SUPERUSER CREATEDB CREATEROLE LOGIN REPLICATION BYPASSRLS PASSWORD 'postgres';
