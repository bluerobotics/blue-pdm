-- LC3 - a relation that can hold rows and has no row-level security, of a kind
-- the lockdown's own check was not looking at.
--
-- The check counted relations with relkind = 'r'. A partitioned parent is 'p'
-- and its leaves are 'r', so enabling RLS on the leaf emptied the count
-- entirely: the leaf dropped out for being protected and the parent was never
-- in it. A SELECT through the parent - which is how anyone queries a
-- partitioned table, and what PostgREST exposes - applies the parent's
-- policies, and there are none.
--
-- Same shape as NC14, which is the control for the release's check_anon_reach().
-- This one is for the emergency script, which was not widened with it.
--
-- No partitioned table exists in BluePLM today. That is the point: the first
-- one must not be able to arrive quietly.
DROP TABLE IF EXISTS lc_partitioned_parts CASCADE;

CREATE TABLE lc_partitioned_parts (
  id UUID DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  part_number TEXT NOT NULL,
  unit_price NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

CREATE TABLE lc_partitioned_parts_2026
  PARTITION OF lc_partitioned_parts
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

-- The leaf is protected, so an audit that lists tables without RLS sees nothing
-- wrong. The parent is what serves the rows.
ALTER TABLE lc_partitioned_parts_2026 ENABLE ROW LEVEL SECURITY;

INSERT INTO lc_partitioned_parts (org_id, part_number, unit_price)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'ACME-SECRET-0001', 14250.00);
