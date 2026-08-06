#!/bin/bash
# Supabase's own bootstrap, run by the role that runs it on a real project.
set -euo pipefail

run_as() {
  local role="$1"; shift
  psql -v ON_ERROR_STOP=1 --no-psqlrc --username "$role" --dbname "$POSTGRES_DB" "$@"
}

# As postgres: this is the file whose unqualified
#   alter default privileges in schema public grant all on functions to ... anon
# creates the pg_default_acl row owned by postgres, and whose
#   alter default privileges for user supabase_admin ...
# creates the one owned by supabase_admin. Running it as supabase_admin instead
# would collapse both into a single row and hide the finding this harness exists
# to test.
run_as postgres -f /supabase-init/00000000000000-initial-schema.sql

# As supabase_admin: the auth schema is AUTHORIZATION supabase_admin.
run_as supabase_admin -f /supabase-init/00000000000001-auth-schema.sql

# The demotion. Now that supabase_admin is the bootstrap superuser rather than
# postgres, this actually takes effect; 90-assert-harness.sql proves it did.
run_as supabase_admin -f /supabase-init/10000000000000_demote-postgres.sql
run_as supabase_admin -f /supabase-init/20230201083204_grant_auth_roles_to_postgres.sql
run_as supabase_admin -f /supabase-init/20230529180330_alter_api_roles_for_inherit.sql
