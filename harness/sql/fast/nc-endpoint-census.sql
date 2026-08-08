-- The class of hole NC18 and NC19 are two instances of, counted rather than
-- listed by hand.
--
-- WHAT IS NOT CHECKED BY ANYTHING, AND WHY THAT IS THE SAME DEFECT TWICE
--
-- Three checks decide whether a routine in public is safe to expose:
--
--   check_anon_reach()        asks has_function_privilege('anon', ...). It says
--                             nothing at all about `authenticated`.
--   check_org_gates()         probes only routines whose identity arguments
--                             contain p_org_id. A routine with no organization
--                             argument produces no row - "correctly and
--                             uselessly", as core.sql puts it.
--   check_withdrawn_execute() asserts the ACL of five routines, named in
--                             withdrawn_execute_manifest(), which core.sql
--                             describes as "small and hand-maintained on
--                             purpose" and adds: "the cost of leaving one out
--                             is what release 95 nearly shipped".
--
-- So a SECURITY DEFINER routine in public, with no p_org_id, that
-- `authenticated` may execute and that is not on the hand-maintained list of
-- five, is examined by nothing. That is exactly what
-- cleanup_extension_http_logs(integer) was until somebody added it to the list -
-- and it is exactly why attack.ps1 reported 0 of 20 attacks succeeding against a
-- schema that still had two real tenancy holes in it. attack.ps1's twenty cases
-- are a hand-written list too. Neither the attack suite nor the verifier
-- enumerates the endpoints; both enumerate the findings somebody already knew
-- about.
--
-- WHAT THIS FILE DOES AND DELIBERATELY DOES NOT DO
--
-- It does not decide that any of these routines is a hole. Most of them are the
-- application's own RPCs, they gate internally on auth.uid() or on access to a
-- named entity, and they have to be callable. Deciding otherwise from here would
-- either lock the product out of its own database or bless whatever is left.
--
-- What it does is produce the census, so that the list can be triaged once and
-- then held still. negative-controls-fast.ps1 compares it against
-- sql/fast/census-baseline.txt and fails when it GROWS. The next
-- cleanup_extension_http_logs then arrives as a line in a diff, at the moment it
-- is created, instead of as a finding two releases later.
--
-- Read-only.

\pset format unaligned
\pset tuples_only on

SELECT '@@NC|census_row|' || sig FROM (
  SELECT p.oid::regprocedure::TEXT AS sig
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind IN ('f', 'p')
    -- SECURITY DEFINER only. An INVOKER routine runs with the caller's own
    -- privileges and row-level security applies to it, so its reach is decided
    -- by the policies rather than by this grant.
    AND p.prosecdef
    -- Reachable over PostgREST by a role a browser can hold. anon is included
    -- because check_anon_reach() blocking on it does not make it uninteresting
    -- here: a routine anon can reach is also one authenticated can.
    AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
         OR has_function_privilege('anon', p.oid, 'EXECUTE'))
    -- check_org_gates() would probe it, so it is covered.
    AND pg_get_function_identity_arguments(p.oid) !~ '\mp_org_id\M'
    -- check_withdrawn_execute() asserts its ACL, so it is covered.
    AND NOT EXISTS (
      SELECT 1 FROM withdrawn_execute_manifest() w
      WHERE to_regprocedure(w.signature) = p.oid)
    -- Deliberately reachable without authentication, with a reason recorded.
    AND NOT EXISTS (
      SELECT 1 FROM anon_execute_allowlist() a
      WHERE a.signature = p.oid::regprocedure::TEXT
         OR a.signature = p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')
  ORDER BY 1
) c;

SELECT '@@NC|census_unprobed|' || count(*)::TEXT
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind IN ('f', 'p')
  AND p.prosecdef
  AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
       OR has_function_privilege('anon', p.oid, 'EXECUTE'))
  AND pg_get_function_identity_arguments(p.oid) !~ '\mp_org_id\M'
  AND NOT EXISTS (
    SELECT 1 FROM withdrawn_execute_manifest() w
    WHERE to_regprocedure(w.signature) = p.oid)
  AND NOT EXISTS (
    SELECT 1 FROM anon_execute_allowlist() a
    WHERE a.signature = p.oid::regprocedure::TEXT
       OR a.signature = p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')');

\pset tuples_only off
\pset format aligned
