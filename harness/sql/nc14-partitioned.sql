-- A partitioned table in public, with row-level security on the leaf and none
-- on the parent.
--
-- The anon sweep filtered relkind = 'r'. A partitioned parent is 'p', so it was
-- never looked at; its leaves are 'r', so they were - which reads as adequate
-- until somebody enables RLS on a leaf. The leaf then drops out of the sweep
-- for being protected, the parent was never in it, and SELECT through the
-- parent, which is how anyone queries a partitioned table, applies the parent's
-- policies. There are none. Verified over HTTP: anon read every row through the
-- parent while check_anon_reach() reported only the known advisory and the
-- schema stamped.
--
-- The leaf's RLS is the part that makes this a control rather than a
-- restatement of "a table without RLS is open". Anyone auditing by listing
-- tables without RLS would see the leaf protected and move on.
--
-- No partitioned table exists in BluePLM today. This is here for the same
-- reason NC8 is: so the first one cannot arrive quietly.
DROP TABLE IF EXISTS nc_partitioned_parts CASCADE;

CREATE TABLE nc_partitioned_parts (
  id UUID DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  part_number TEXT NOT NULL,
  unit_price NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

CREATE TABLE nc_partitioned_parts_2026
  PARTITION OF nc_partitioned_parts
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

-- The leaf is protected. The parent is not, and the parent is what PostgREST
-- serves at /rest/v1/nc_partitioned_parts.
ALTER TABLE nc_partitioned_parts_2026 ENABLE ROW LEVEL SECURITY;

INSERT INTO nc_partitioned_parts (org_id, part_number, unit_price)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'ACME-SECRET-0001', 14250.00);
