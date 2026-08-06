-- Negative control for finding 2: put parts_with_pricing back the way it was -
-- a plain view, so it runs as its owner and no row-level policy applies, and
-- readable by anon.
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_viewdef('public.parts_with_pricing'::regclass) INTO v_def;
  EXECUTE 'DROP VIEW public.parts_with_pricing';
  EXECUTE 'CREATE VIEW public.parts_with_pricing AS ' || v_def;
  EXECUTE 'GRANT SELECT ON public.parts_with_pricing TO anon, authenticated';
END $$;
