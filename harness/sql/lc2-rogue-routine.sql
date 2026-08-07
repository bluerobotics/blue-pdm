-- LC2, part two of two. RUN AS supabase_admin, NOT AS postgres.
--
-- A routine in public that anon can execute and that is not on the pre-login
-- allowlist. Created by supabase_admin for the same reason nc7-unrevokable.sql
-- is: postgres cannot revoke a grant it did not make, so the routine survives
-- the lockdown's sweep and is still there when the check at the bottom of the
-- script runs. A routine postgres *could* revoke would simply be revoked, and
-- the check would have nothing left to be wrong about.
--
-- It takes an organization id and returns rows for it without asking who is
-- calling, so it is not merely an unexpected name in a catalogue listing: it is
-- the exact shape - an entity id, no membership test - that the last three
-- releases were spent removing.
CREATE OR REPLACE FUNCTION public.lc_rogue_anon_routine(p_org_id UUID)
RETURNS TABLE (part_number TEXT, description TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT f.part_number, f.description FROM public.files f WHERE f.org_id = p_org_id;
$$;

-- Belt and braces. The built-in default already grants EXECUTE to PUBLIC, which
-- anon holds through; naming anon makes the row unambiguous in aclexplode.
GRANT EXECUTE ON FUNCTION public.lc_rogue_anon_routine(UUID) TO anon;
