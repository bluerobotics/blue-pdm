-- RUN AS supabase_admin, NOT AS postgres.
--
-- The condition nobody can clear, constructed deliberately, because the harness
-- cannot produce it by accident: it runs no supautils and its extensions are
-- pre-placed.
--
-- On Supabase, CREATE EXTENSION for a privileged extension is executed by
-- supabase_admin, so the extension's functions land in whatever schema was
-- named - public, if none was - owned by supabase_admin and granted EXECUTE to
-- PUBLIC by the built-in default. postgres cannot revoke a grant it did not
-- make: `REVOKE EXECUTE ... FROM anon` answers "WARNING: no privileges could be
-- revoked" and changes nothing at all.
--
-- The release before this one graded that blocking. A correctly installed
-- project, with every manifest object present, could therefore be permanently
-- unstampable, and the advice printed next to the refusal was to run the
-- function that had just failed to help. core.sql line 28 was a live route
-- into it: `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` with no SCHEMA clause,
-- and postgres's search_path starting at public. BluePLM no longer installs any
-- extension - gen_random_uuid() is built in - but a project can arrive in this
-- state through any extension anybody installs, so the grading has to be right
-- regardless.
--
-- What this control requires:
--
--   * the row is REPORTED, in full, with the grantor named
--   * it is graded advisory, not blocking
--   * the stamp is still granted
--
-- and the posture control beside it requires that a routine postgres CAN revoke
-- is still blocking, so "advisory" is decided by the catalogue and not by
-- anything convenient.
CREATE OR REPLACE FUNCTION public.nc_unrevokable(p_anything TEXT DEFAULT NULL)
RETURNS TEXT LANGUAGE sql AS $$ SELECT 'installed by supabase_admin' $$;

-- Belt and braces. The built-in default already grants EXECUTE to PUBLIC, which
-- anon holds through; naming anon makes the row unambiguous in aclexplode.
GRANT EXECUTE ON FUNCTION public.nc_unrevokable(TEXT) TO anon;
