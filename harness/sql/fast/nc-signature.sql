-- A fingerprint of everything tools/verify-schema.sql looks at.
--
-- WHY THIS EXISTS
--
-- negative-controls.ps1 proves each repair worked by running the whole
-- verification again and requiring the stamp back. That is 18 of the 41
-- verification runs in the suite, and each of them re-reads every function body
-- in the schema through strip_sql_noise().
--
-- negative-controls-fast.ps1 isolates each control in a transaction and rolls it
-- back instead. A ROLLBACK restores the catalogue exactly, so the verification
-- would necessarily reach the same verdict it reached on the baseline - but
-- "necessarily" is a claim, and this file is what turns it into a measurement.
-- After every rollback the signature is taken again and compared with the one
-- taken on the clean database. If they match, the inputs to every check are the
-- inputs the baseline verified clean with, and no second verification is needed.
-- If they do not, the run stops and says so.
--
-- WHAT IT COVERS, AND HOW THAT LIST WAS CHOSEN
--
-- Not "everything" - everything the seven check functions actually read. Each
-- block below names the check that reads it. An input missing from here is the
-- one way this argument can fail, so the list is derived from the checks rather
-- than guessed at, and negative-controls-fast.ps1 -SelfTest deliberately leaves
-- an object behind and requires the comparison to catch it.
--
--   pg_proc in public       check_org_gates, check_anon_reach,
--     (identity, source,    check_null_unsafe_org_gates, check_unbound_entity_args,
--      ACL, flags)          check_withdrawn_execute, check_schema_release
--   pg_class in public      check_anon_reach (tables, views, matviews,
--     and storage.objects   partitioned and foreign tables, security_invoker,
--                           row-level security), check_schema_release
--   pg_attribute.attacl     check_anon_reach via has_any_column_privilege - a
--                           grant on one column is invisible to relacl, which
--                           is how a view with GRANT SELECT (part_number) was
--                           read over HTTP while the sweep reported nothing
--   pg_policy               check_anon_reach via anon_admitting_policies
--   pg_default_acl          check_anon_reach's default_privilege rows
--   check_release_residue() the data half. Its own output is used rather than
--                           the tables it reads, because the tables are large
--                           and the verdict is what matters
--
-- schema_version is deliberately excluded: it is the thing the verification
-- writes, so including it would make every signature comparison fail for the
-- one reason that is not a finding.
--
-- Safe to run at any time; it creates a schema of its own and reads only
-- catalogues. Nothing in it is visible to any check in verify-schema.sql, all
-- of which are scoped to nspname = 'public'.

CREATE SCHEMA IF NOT EXISTS harness_fast;

CREATE OR REPLACE FUNCTION harness_fast.catalog_signature()
RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT md5(string_agg(part, E'\n' ORDER BY part))
  FROM (
    -- Routines. Identity by regprocedure rather than by oid, so that a function
    -- dropped and recreated with the same signature compares equal - which is
    -- what a repair does and what must not read as a difference.
    -- Every "char" column below is cast explicitly. `text || "char"` is
    -- ambiguous - anynonarray||text and text||anynonarray both match, and
    -- "char" has no implicit cast to text to break the tie - so without the
    -- cast the CREATE fails with "operator is not unique" and this function
    -- never comes into existence. It failed that way on every run until
    -- -SelfTest ST5 exposed it: the runner read psql's error echo as the
    -- signature value, compared that constant against itself, and reported
    -- every rollback as faithful.
    SELECT 'proc|' || p.oid::regprocedure::TEXT
           || '|' || p.prokind::TEXT
           || '|' || p.prosecdef::TEXT
           || '|' || l.lanname
           || '|' || pg_get_userbyid(p.proowner)
           || '|' || md5(p.prosrc)
           || '|' || COALESCE(p.proacl, acldefault('f', p.proowner))::TEXT AS part
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public'

    UNION ALL

    -- Relations. reloptions carries security_invoker, relrowsecurity decides
    -- whether policies are consulted at all, and relispartition is what makes a
    -- leaf reachable only through its parent.
    SELECT 'rel|' || n.nspname || '.' || c.relname
           || '|' || c.relkind::TEXT
           || '|' || c.relrowsecurity::TEXT
           || '|' || c.relispartition::TEXT
           || '|' || pg_get_userbyid(c.relowner)
           || '|' || COALESCE(array_to_string(c.reloptions, ','), '')
           || '|' || COALESCE(c.relacl, acldefault('r', c.relowner))::TEXT
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE (n.nspname = 'public' OR (n.nspname = 'storage' AND c.relname = 'objects'))
      AND c.relkind IN ('r', 'p', 'f', 'v', 'm', 'S')

    UNION ALL

    -- Column grants. has_table_privilege is false for one and
    -- has_any_column_privilege is true, and the difference between those two is
    -- an entire class of exposure (NC16, LC1), so the column ACLs are in the
    -- fingerprint even though nothing else in the catalogue would show them.
    SELECT 'col|' || n.nspname || '.' || c.relname || '.' || a.attname
           || '|' || a.attacl::TEXT
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'storage')
      AND NOT a.attisdropped
      AND a.attnum > 0
      AND a.attacl IS NOT NULL

    UNION ALL

    -- Policies, expression text and all. A WITH CHECK that quietly disappears
    -- is the whole subject of policy-controls.ps1, and it changes no other
    -- catalogue row.
    SELECT 'pol|' || n.nspname || '.' || c.relname || '|' || pol.polname
           || '|' || pol.polcmd::TEXT
           || '|' || pol.polpermissive::TEXT
           || '|' || COALESCE((SELECT string_agg(r.rolname, ',' ORDER BY r.rolname)
                               FROM unnest(pol.polroles) AS rid
                               LEFT JOIN pg_roles r ON r.oid = rid), 'PUBLIC')
           || '|' || COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '')
           || '|' || COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'storage')

    UNION ALL

    -- What a function created next will be born with. This is the row that made
    -- the anon-execute problem recur rather than stay fixed.
    SELECT 'defacl|' || pg_get_userbyid(d.defaclrole)
           || '|' || d.defaclobjtype::TEXT
           || '|' || d.defaclacl::TEXT
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
    WHERE n.nspname = 'public'

    UNION ALL

    -- And the data half, taken as the check's own verdict rather than as the
    -- rows it reads. NC12, NX1 and NX2 all change this and nothing else.
    SELECT 'residue|' || residue || '|' || identity
    FROM check_release_residue()

    -- One constant row, so that an empty result still produces a signature
    -- rather than NULL. A NULL signature compared against a NULL signature
    -- would report every rollback as faithful.
    UNION ALL SELECT 'harness_fast.catalog_signature/v1'
  ) s;
$$;

REVOKE ALL ON FUNCTION harness_fast.catalog_signature() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SCHEMA harness_fast FROM PUBLIC, anon, authenticated;
