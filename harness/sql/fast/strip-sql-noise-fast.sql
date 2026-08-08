-- OPTIONAL. Read this whole header before running it.
--
-- This file replaces public.strip_sql_noise() with an implementation that scans
-- between interesting characters instead of one character at a time. It refuses
-- to do so unless a differential test proves the two agree, character for
-- character, on every function body installed in this database and on a set of
-- cases built to break the state machine.
--
-- WHY IT EXISTS
--
-- tools/verify-schema.sql calls check_null_unsafe_org_gates() three times and
-- check_unbound_entity_args() three times - twice each in its own report blocks
-- and once more inside verify_and_stamp_schema(). Both scan every function body
-- in public through strip_sql_noise(). That is six full passes over roughly a
-- quarter of a million characters of PL/pgSQL per verification, and
-- negative-controls.ps1 runs the verification forty times.
--
-- The original walks the string one character at a time in PL/pgSQL, executing
-- two substr() calls and several branches per character. PL/pgSQL is an
-- interpreter over an expression evaluator; a loop body like that costs
-- microseconds, not nanoseconds. Six passes is on the order of 1.8 million
-- iterations per verification, and 40 verifications is 70 million.
--
-- IS THIS ACTUALLY THE BOTTLENECK? NOTHING HERE WAS MEASURED.
--
-- It is the largest single term I can identify by reading, and I could not run
-- anything - see FAST-SUITE.md. It is not the only candidate: check_org_gates()
-- EXECUTEs every probed function inside a subtransaction, and check_anon_reach()
-- asks has_any_column_privilege() per column. Settle it before believing it:
--
--   .\negative-controls-fast.ps1 -Tier standard -Only NC4 -Timing
--
-- run once before this file and once after, and compare the seconds printed for
-- the verification session. If the difference is small, the cost is elsewhere
-- and this file should be reverted by re-applying supabase/core.sql.
--
-- WHY THIS IS NOT PART OF THE FAST SUITE AND MUST NOT BE USED FOR A RELEASE
--
-- strip_sql_noise() is part of the artefact under test. Everything the verifier
-- concludes about missing authorization checks is filtered through it, and a
-- release signed off on a database whose copy of it came from the harness is a
-- release verified by code that is not in the release. The equivalence proof
-- below is strong, and it is still not the same thing as running the shipped
-- function.
--
-- So: development loops yes, release gates no. Sign a release off on a database
-- built by reset.ps1 with this file never applied.
--
-- WHAT MAKES THE SWAP INVISIBLE TO THE CHECKS
--
-- Three things had to be true and were checked in the source rather than
-- assumed:
--   - strip_sql_noise() is not an object in schema_release_manifest(). The
--     manifest mentions the NAME, as a substring that must appear inside
--     check_null_unsafe_org_gates()'s body; it does not hash this function.
--     Replacing the body therefore produces no 'stale' row.
--   - check_null_unsafe_org_gates() excludes proname IN
--     ('check_null_unsafe_org_gates', 'strip_sql_noise') from its own scan, so
--     the quotes and dashes in the new body cannot make it report itself.
--   - CREATE OR REPLACE keeps the owner and the ACL, so nothing about
--     reachability changes and check_anon_reach() sees what it saw.
--
-- TO REVERT
--
--   docker compose exec -T -e PGPASSWORD=postgres db \
--     psql -U postgres -d postgres -h 127.0.0.1 -f /blueplm/core.sql
--
-- or just .\reset.ps1, which is what a release gate should be starting from.

CREATE SCHEMA IF NOT EXISTS harness_fast;

-- ---------------------------------------------------------------------------
-- The candidate.
--
-- EQUIVALENCE ARGUMENT
--
-- Same four states, same nesting depth, same index arithmetic. The only change
-- is that runs of characters which the original would have handled identically
-- one at a time are handled in one step:
--
--   normal  The original copies any character that does not begin '--', '/*'
--           or a quote. So the run from i up to the next occurrence of '-', '/'
--           or '\'' is copied verbatim, and the decision is then made at that
--           character exactly as the original makes it - including the two
--           cases where a lone '-' or '/' is simply copied.
--   line    The original discards every character until a newline, emits the
--           newline, and returns to normal. Jumping to the newline discards the
--           same characters.
--   block   The original tests, at every position, whether the two characters
--           there are '/*' or '*/'. Jumping to the earliest position at or
--           after i where that is true visits exactly the positions at which
--           the original does anything, and the ones it skips are the ones the
--           original passed over with i := i + 1.
--   quote   Between i and the next quote there is nothing the original acts on.
--           At the quote, '' means an escaped quote and skips two, and a lone
--           quote closes - which is what this does.
--
-- The output accumulator changed too: an array appended to and joined at the
-- end, rather than `v_out := v_out || c`. PL/pgSQL keeps a local array variable
-- in its expanded form, so array_append is amortised constant; text
-- concatenation copies the whole accumulated string every time. That is a real
-- but secondary cost - the bodies here are mostly short - and the change is free.
--
-- array_to_string skips NULL elements; no NULL is ever appended.
--
-- NULL input returns '' rather than NULL, matching the original, which is not
-- STRICT and whose WHILE condition is simply never true.
--
-- None of the above is taken on faith. The DO block after it checks it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION harness_fast.strip_sql_noise_fast(p_src TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  v_parts TEXT[] := ARRAY[]::TEXT[];
  v_len   INTEGER := length(p_src);
  i       INTEGER := 1;
  v_tail  TEXT;
  v_state TEXT := 'normal';   -- normal | line | block | quote
  v_depth INTEGER := 0;
  j_q     INTEGER;
  j_d     INTEGER;
  j_s     INTEGER;
  j_open  INTEGER;
  j_close INTEGER;
  j_rel   INTEGER;            -- offset within v_tail, 1-based
  k       INTEGER;            -- absolute index in p_src
  c       TEXT;
  c2      TEXT;
BEGIN
  WHILE i <= v_len LOOP
    v_tail := substr(p_src, i);

    IF v_state = 'normal' THEN
      -- The three characters that can begin something. Everything else is
      -- copied, which is what lets the run be copied in one go.
      j_q := NULLIF(strpos(v_tail, ''''), 0);
      j_d := NULLIF(strpos(v_tail, '-'), 0);
      j_s := NULLIF(strpos(v_tail, '/'), 0);
      j_rel := LEAST(j_q, j_d, j_s);

      IF j_rel IS NULL THEN
        v_parts := array_append(v_parts, v_tail);
        EXIT;
      END IF;

      IF j_rel > 1 THEN
        v_parts := array_append(v_parts, substr(v_tail, 1, j_rel - 1));
      END IF;

      k := i + j_rel - 1;
      c  := substr(p_src, k, 1);
      c2 := substr(p_src, k, 2);

      IF c2 = '--' THEN
        v_state := 'line'; i := k + 2;
      ELSIF c2 = '/*' THEN
        v_state := 'block'; v_depth := 1; i := k + 2;
      ELSIF c = '''' THEN
        v_state := 'quote'; i := k + 1;
      ELSE
        -- A '-' or '/' that begins nothing. The original copies it and moves on.
        v_parts := array_append(v_parts, c);
        i := k + 1;
      END IF;

    ELSIF v_state = 'line' THEN
      j_rel := NULLIF(strpos(v_tail, E'\n'), 0);
      IF j_rel IS NULL THEN
        EXIT;                                  -- comment runs to end of input
      END IF;
      v_parts := array_append(v_parts, E'\n');  -- the original keeps the newline
      v_state := 'normal';
      i := i + j_rel;

    ELSIF v_state = 'block' THEN
      j_open  := NULLIF(strpos(v_tail, '/*'), 0);
      j_close := NULLIF(strpos(v_tail, '*/'), 0);
      j_rel := LEAST(j_open, j_close);

      IF j_rel IS NULL THEN
        EXIT;                                  -- unterminated block comment
      END IF;

      -- '/*' and '*/' cannot begin at the same index, so this is unambiguous.
      IF j_rel = j_open THEN
        v_depth := v_depth + 1;
      ELSE
        v_depth := v_depth - 1;
        IF v_depth = 0 THEN v_state := 'normal'; END IF;
      END IF;
      i := i + j_rel + 1;                      -- (i + j_rel - 1) + 2

    ELSE -- quote
      j_rel := NULLIF(strpos(v_tail, ''''), 0);
      IF j_rel IS NULL THEN
        EXIT;                                  -- unterminated literal
      END IF;
      k := i + j_rel - 1;
      IF substr(p_src, k, 2) = '''''' THEN
        i := k + 2;                            -- escaped quote, still inside
      ELSE
        v_state := 'normal';
        i := k + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN array_to_string(v_parts, '');
END;
$fn$;

-- ---------------------------------------------------------------------------
-- The proof, and the gate. Nothing below installs anything if the two disagree.
--
-- Two populations. The adversarial cases are the ones a reviewer would ask
-- about, several of which are the difference between the two implementations if
-- the argument above is wrong anywhere. The installed function bodies are the
-- only input that matters in practice, and there are hundreds of them, written
-- by people rather than by somebody trying to break a parser.
--
-- Both forms are tested because both are used: check_schema_release() feeds
-- pg_get_functiondef() through it and the other two checks feed prosrc.
-- ---------------------------------------------------------------------------
DO $test$
DECLARE
  v_cases TEXT[] := ARRAY[
    -- Ordinary
    'SELECT 1;',
    '',
    -- Line comment, kept newline
    E'a -- comment\nb',
    E'a -- comment with '' apostrophe\nb',
    'a -- comment running to the very end',
    -- Block comments, including the nesting the original tracks a depth for
    'a /* c */ b',
    'a /* outer /* inner */ still outer */ b',
    'a /* unterminated',
    'a /*/ b',        -- '/*' then '/' inside
    'a */ b',         -- a close with no open, in normal state
    'a /**/ b',
    'a /* -- not a line comment */ b',
    E'a /* spanning\nlines */ b',
    -- Literals
    'a ''lit'' b',
    'a ''it''''s'' b',
    'a ''''''''''  b',           -- five quotes and change
    'a ''unterminated',
    'a ''-- not a comment'' b',
    'a ''/* not a block */'' b',
    -- Lone operators that begin nothing
    'a - b',
    'a / b',
    'a-b/c',
    'x - - y',
    'x / / y',
    -- The shape that actually matters: an authorization call next to prose
    E'-- this used to call require_org_member(p_org_id)\n  PERFORM require_org_member(p_org_id);',
    E'RAISE NOTICE ''require_org_member'';\n  PERFORM require_org_member(p_org_id);',
    -- Dollar quoting is deliberately NOT special-cased by the original
    'AS $$ SELECT ''x'' $$',
    -- Degenerate
    '-', '/', '''', '--', '/*', '*/', E'\n', ' '
  ];
  v_case    TEXT;
  v_slow    TEXT;
  v_fast    TEXT;
  v_bad     INTEGER := 0;
  v_checked INTEGER := 0;
  r         RECORD;
BEGIN
  FOREACH v_case IN ARRAY v_cases LOOP
    v_checked := v_checked + 1;
    v_slow := public.strip_sql_noise(v_case);
    v_fast := harness_fast.strip_sql_noise_fast(v_case);
    IF v_slow IS DISTINCT FROM v_fast THEN
      v_bad := v_bad + 1;
      RAISE WARNING 'DIFFERENCE on case %: shipped produced %, fast produced %',
        quote_literal(v_case), quote_literal(v_slow), quote_literal(v_fast);
    END IF;
  END LOOP;

  -- NULL separately: FOREACH over an array containing NULL is awkward and the
  -- behaviour is worth stating out loud, because neither function is STRICT and
  -- both return the empty string rather than NULL.
  v_checked := v_checked + 1;
  IF public.strip_sql_noise(NULL) IS DISTINCT FROM harness_fast.strip_sql_noise_fast(NULL) THEN
    v_bad := v_bad + 1;
    RAISE WARNING 'DIFFERENCE on NULL input: shipped produced %, fast produced %',
      quote_literal(COALESCE(public.strip_sql_noise(NULL), '<NULL>')),
      quote_literal(COALESCE(harness_fast.strip_sql_noise_fast(NULL), '<NULL>'));
  END IF;

  FOR r IN
    SELECT p.oid::regprocedure::TEXT AS sig, p.prosrc AS src, 'prosrc' AS form
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
    UNION ALL
    SELECT p.oid::regprocedure::TEXT, pg_get_functiondef(p.oid), 'functiondef'
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
  LOOP
    v_checked := v_checked + 1;
    v_slow := public.strip_sql_noise(r.src);
    v_fast := harness_fast.strip_sql_noise_fast(r.src);
    IF v_slow IS DISTINCT FROM v_fast THEN
      v_bad := v_bad + 1;
      RAISE WARNING 'DIFFERENCE on % (%): outputs are % and % characters and do not match',
        r.sig, r.form, length(v_slow), length(v_fast);
    END IF;
  END LOOP;

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'strip_sql_noise_fast disagrees with the shipped function on % of % inputs. Nothing was replaced. The warnings above name them.',
      v_bad, v_checked;
  END IF;

  RAISE NOTICE 'strip_sql_noise_fast agrees with the shipped function on all % inputs (% adversarial cases and every installed function body, in both prosrc and pg_get_functiondef form).',
    v_checked, array_length(v_cases, 1) + 1;
END
$test$;

-- ---------------------------------------------------------------------------
-- Only now. If the block above raised, psql with ON_ERROR_STOP on never gets
-- here, and without it the transaction is aborted and this statement cannot
-- run either - so the gate holds under both invocations.
--
-- The body is the same text as harness_fast.strip_sql_noise_fast, because the
-- thing that was proved equivalent has to be the thing that gets installed.
-- Keep them identical if either is edited.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.strip_sql_noise(p_src TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  v_parts TEXT[] := ARRAY[]::TEXT[];
  v_len   INTEGER := length(p_src);
  i       INTEGER := 1;
  v_tail  TEXT;
  v_state TEXT := 'normal';
  v_depth INTEGER := 0;
  j_q     INTEGER;
  j_d     INTEGER;
  j_s     INTEGER;
  j_open  INTEGER;
  j_close INTEGER;
  j_rel   INTEGER;
  k       INTEGER;
  c       TEXT;
  c2      TEXT;
BEGIN
  WHILE i <= v_len LOOP
    v_tail := substr(p_src, i);

    IF v_state = 'normal' THEN
      j_q := NULLIF(strpos(v_tail, ''''), 0);
      j_d := NULLIF(strpos(v_tail, '-'), 0);
      j_s := NULLIF(strpos(v_tail, '/'), 0);
      j_rel := LEAST(j_q, j_d, j_s);

      IF j_rel IS NULL THEN
        v_parts := array_append(v_parts, v_tail);
        EXIT;
      END IF;

      IF j_rel > 1 THEN
        v_parts := array_append(v_parts, substr(v_tail, 1, j_rel - 1));
      END IF;

      k := i + j_rel - 1;
      c  := substr(p_src, k, 1);
      c2 := substr(p_src, k, 2);

      IF c2 = '--' THEN
        v_state := 'line'; i := k + 2;
      ELSIF c2 = '/*' THEN
        v_state := 'block'; v_depth := 1; i := k + 2;
      ELSIF c = '''' THEN
        v_state := 'quote'; i := k + 1;
      ELSE
        v_parts := array_append(v_parts, c);
        i := k + 1;
      END IF;

    ELSIF v_state = 'line' THEN
      j_rel := NULLIF(strpos(v_tail, E'\n'), 0);
      IF j_rel IS NULL THEN
        EXIT;
      END IF;
      v_parts := array_append(v_parts, E'\n');
      v_state := 'normal';
      i := i + j_rel;

    ELSIF v_state = 'block' THEN
      j_open  := NULLIF(strpos(v_tail, '/*'), 0);
      j_close := NULLIF(strpos(v_tail, '*/'), 0);
      j_rel := LEAST(j_open, j_close);

      IF j_rel IS NULL THEN
        EXIT;
      END IF;

      IF j_rel = j_open THEN
        v_depth := v_depth + 1;
      ELSE
        v_depth := v_depth - 1;
        IF v_depth = 0 THEN v_state := 'normal'; END IF;
      END IF;
      i := i + j_rel + 1;

    ELSE
      j_rel := NULLIF(strpos(v_tail, ''''), 0);
      IF j_rel IS NULL THEN
        EXIT;
      END IF;
      k := i + j_rel - 1;
      IF substr(p_src, k, 2) = '''''' THEN
        i := k + 2;
      ELSE
        v_state := 'normal';
        i := k + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN array_to_string(v_parts, '');
END;
$fn$;

REVOKE ALL ON FUNCTION public.strip_sql_noise(TEXT) FROM PUBLIC, anon;

DO $$
BEGIN
  RAISE NOTICE 'public.strip_sql_noise() replaced with the scanning implementation. This database is no longer running the shipped function - do not sign a release off on it. Re-apply /blueplm/core.sql or run reset.ps1 to revert.';
END $$;
