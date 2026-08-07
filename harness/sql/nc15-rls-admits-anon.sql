-- Row-level security enabled, and a policy that hands anon every row.
--
-- The sweep asked `relrowsecurity` and stopped, which is a check that policies
-- APPLY, not a check that anon is excluded. Those are different questions and
-- the gap between them is a whole class of exposure: this table is readable at
-- GET /rest/v1/nc_rls_but_open with no JWT at all, and every inventory in the
-- schema calls it protected because the flag is on. Measured over HTTP against
-- the previous release, which stamped.
--
-- Written the way somebody writes it by accident: a table the sign-in screen
-- needs to read, a policy added TO anon to make that work, and USING (true)
-- because scoping it to an organization is not obvious when the caller has no
-- organization yet.
DROP TABLE IF EXISTS nc_rls_but_open CASCADE;

CREATE TABLE nc_rls_but_open (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  part_number TEXT NOT NULL,
  unit_price NUMERIC
);

ALTER TABLE nc_rls_but_open ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can read nc_rls_but_open"
  ON nc_rls_but_open FOR SELECT TO anon
  USING (true);

INSERT INTO nc_rls_but_open (org_id, part_number, unit_price)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'ACME-SECRET-0001', 14250.00);
