-- Can a member of one organization read another organization's vault objects?
--
-- Asked in SQL rather than over HTTP because PostgREST is configured with
-- PGRST_DB_SCHEMAS=public and cannot serve the storage schema - which is also
-- true of a real deployment: Storage is a separate service with its own
-- connection, and it authenticates as `authenticated` with the caller's JWT
-- claims exactly as reproduced here. What governs the read either way is the
-- policy set on storage.objects, and that is what this measures.
--
-- SET LOCAL ROLE, so the read is performed as `authenticated` and RLS applies.
-- Running as postgres would answer the wrong question: postgres has BYPASSRLS
-- in this container and would read both tenants' objects whatever the policies
-- said, which is precisely the mistake the harness exists to avoid.

\set acme_org '''aaaaaaaa-0000-4000-8000-000000000001'''
\set umb_org  '''bbbbbbbb-0000-4000-8000-000000000001'''
\set bob      '''bbbbbbbb-1111-4000-8000-000000000001'''
\set alice    '''aaaaaaaa-1111-4000-8000-000000000001'''

BEGIN;

-- Bob is a real, signed-in member of Umbrella.
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', :bob, 'role', 'authenticated')::text,
                  true);
SET LOCAL ROLE authenticated;

SELECT 'BOB_READS_ACME=' || count(*) AS probe
  FROM storage.objects
 WHERE bucket_id = 'vault' AND (storage.foldername(name))[1] = :acme_org;

SELECT 'BOB_READS_OWN=' || count(*) AS probe
  FROM storage.objects
 WHERE bucket_id = 'vault' AND (storage.foldername(name))[1] = :umb_org;

RESET ROLE;

-- Alice is a member of Acme, and must still see Acme's own objects. Without
-- this half, "Bob reads nothing" is also what a bucket nobody can read at all
-- produces - which is exactly the state the harness is in until A2 lands, and
-- the reason the control above is reported as pending rather than as a pass.
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', :alice, 'role', 'authenticated')::text,
                  true);
SET LOCAL ROLE authenticated;

SELECT 'ALICE_READS_OWN=' || count(*) AS probe
  FROM storage.objects
 WHERE bucket_id = 'vault' AND (storage.foldername(name))[1] = :acme_org;

RESET ROLE;

COMMIT;

-- The inventory the control reads to decide whether A2 has landed.
SELECT 'POLICY=' || policyname || '|' || cmd AS probe
  FROM pg_policies
 WHERE schemaname = 'storage' AND tablename = 'objects'
 ORDER BY policyname;

SELECT 'RLS_ENABLED=' || c.relrowsecurity AS probe
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'storage' AND c.relname = 'objects';
