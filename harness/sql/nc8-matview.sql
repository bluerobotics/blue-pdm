-- A materialized view in public.
--
-- Strictly worse than the plain view that caused the original leak, and it
-- produced no row in any check. The security_invoker sweep filters
-- relkind = 'v' and has to: a materialized view cannot be security_invoker,
-- because the option does not exist for one. The table sweep filters
-- relkind = 'r'. The anon sweep only sees it if anon in particular can read it,
-- and here only authenticated can - which is the whole point, because a
-- matview holds its own stored rows and carries no row-level security, so every
-- authenticated caller reads every organization's data out of it.
--
-- None exist in BluePLM. This is here so that the first one cannot arrive
-- quietly, and it deliberately grants to authenticated only, so that a check
-- which merely re-covered the anon case would not catch it.
CREATE MATERIALIZED VIEW IF NOT EXISTS nc_all_tenants_matview AS
  SELECT f.id, f.org_id, f.part_number, f.description
  FROM files f;

GRANT SELECT ON nc_all_tenants_matview TO authenticated;
