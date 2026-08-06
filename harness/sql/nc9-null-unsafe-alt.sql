-- The same NULL-unsafe membership test, spelled four other ways.
--
-- NC3 writes it exactly as the nine shipped sites wrote it:
--
--   IF p_org_id NOT IN (SELECT org_id FROM users WHERE id = auth.uid()) THEN
--
-- and the first version of check_null_unsafe_org_gates() was a literal regex
-- for that. It found all nine, and the release said the shape was "banned
-- outright". It was not - one spelling of it was. Every function below is the
-- identical defect: for a caller whose users.org_id is NULL the comparison is
-- NULL rather than true, the refusal does not fire, and the body runs against
-- whatever organization was named.
--
-- Each is created separately so that a check which catches one and misses the
-- rest reports a partial list rather than a pass.
--
--   alt1  a schema-qualified table and a column alias
--   alt2  <> ALL
--   alt3  NOT (x IN (...)), the negation moved outside
--   alt4  LANGUAGE sql, which the plpgsql-only sweep never even read

CREATE OR REPLACE FUNCTION nc_null_unsafe_alt1(p_org_id UUID)
RETURNS TEXT AS $$
BEGIN
  IF p_org_id NOT IN (SELECT u.org_id FROM public.users u WHERE u.id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;
  RETURN 'reached';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION nc_null_unsafe_alt2(p_org_id UUID)
RETURNS TEXT AS $$
BEGIN
  IF p_org_id <> ALL (SELECT u.org_id FROM users u WHERE u.id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;
  RETURN 'reached';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION nc_null_unsafe_alt3(p_org_id UUID)
RETURNS TEXT AS $$
BEGIN
  IF NOT (p_org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;
  RETURN 'reached';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION nc_null_unsafe_alt4(p_org_id UUID)
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT CASE
    WHEN p_org_id NOT IN (SELECT org_id FROM users WHERE id = auth.uid())
      THEN 'refused'
    ELSE 'reached'
  END;
$$;
