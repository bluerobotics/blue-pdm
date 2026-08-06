-- How many functions have finding 3's shape: an org id argument that is gated,
-- plus a second argument that actually selects the row. Used to decide whether
-- a verifier check for that shape can be precise rather than fuzzy.
\pset pager off

SELECT p.oid::regprocedure AS sig,
       (SELECT string_agg(a, ',') FROM unnest(coalesce(p.proargnames,'{}')) a
         WHERE a ~ '_id$' AND a <> 'p_org_id') AS other_id_args,
       (p.prosrc ~ 'require_org_member\s*\(\s*p_org_id'
        OR p.prosrc ~ 'is_org_member\s*\(\s*p_org_id') AS gates_on_org_arg
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND l.lanname = 'plpgsql'
  AND 'p_org_id' = ANY(coalesce(p.proargnames, '{}'))
  AND EXISTS (SELECT 1 FROM unnest(p.proargnames) a
               WHERE a ~ '_id$' AND a <> 'p_org_id')
ORDER BY 3 DESC, 1;
