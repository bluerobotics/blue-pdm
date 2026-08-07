-- RUN AS supabase_admin - postgres cannot drop what it did not create.
DROP FUNCTION IF EXISTS public.lc_rogue_anon_routine(UUID);
