-- For each function with the two-argument shape, show every line of its body
-- that mentions the second (row-selecting) argument, so the binding to the
-- organisation can be read directly rather than assumed.
\pset pager off
\pset format unaligned
\pset fieldsep ' | '

WITH shaped AS (
  SELECT p.oid,
         p.oid::regprocedure::text AS sig,
         p.prosrc,
         a.argname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  CROSS JOIN LATERAL unnest(coalesce(p.proargnames, '{}')) WITH ORDINALITY AS a(argname, ord)
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND l.lanname = 'plpgsql'
    AND 'p_org_id' = ANY(coalesce(p.proargnames, '{}'))
    AND a.argname ~ '_id$'
    AND a.argname <> 'p_org_id'
    -- IN arguments only: OUT columns called link_id or client_id are not a
    -- way to select somebody else's row.
    AND (p.proargmodes IS NULL OR p.proargmodes[a.ord] IN ('i', 'b'))
)
SELECT sig, argname, line
FROM shaped
CROSS JOIN LATERAL (
  SELECT string_agg(trim(l2), ' ~~ ') AS line
  FROM unnest(string_to_array(shaped.prosrc, E'\n')) l2
  WHERE l2 LIKE '%' || shaped.argname || '%'
) x
ORDER BY sig, argname;
