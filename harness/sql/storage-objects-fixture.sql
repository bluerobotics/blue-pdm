-- A storage.objects the harness can attack, seeded with two tenants' objects.
--
-- WHY THE HARNESS HAS TO BUILD THIS
--
-- storage.objects belongs to Supabase's Storage service, not to BluePLM's
-- schema, so nothing in supabase/ creates it and the harness container has
-- never had one. That is why no release has ever been able to say anything
-- about the vault bucket: there was nothing to say it against. Finding E-crit
-- in the review is that the four policies a deployment relies on are not in
-- version control at all.
--
-- Faithful in the two respects that matter to a policy: the column set the
-- policies name (bucket_id, name, owner), and storage.foldername(), which is
-- the function the whole authorization term is built out of. Everything else
-- Storage puts on this table - the upload state machine, the multipart rows -
-- is irrelevant to who may read an object and is deliberately absent.
--
-- OBJECT PATHS ARE THE POINT
--
-- BluePLM stores at {org_id}/{content_hash[0:2]}/{content_hash}, so the first
-- path component is the owning organization and is the entire authorization
-- term. files.content_hash is readable org-wide, which is what makes the
-- absence of that term enumerable rather than merely permissive: a member of
-- one organization can read another's hashes from their own file list and
-- construct the path.

CREATE SCHEMA IF NOT EXISTS storage;

-- Supabase's own implementation: split on '/' and drop the last element, so
-- foldername('acme/ab/hash') is {acme,ab} and [1] is the organization.
CREATE OR REPLACE FUNCTION storage.foldername(name TEXT)
RETURNS TEXT[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_parts TEXT[];
BEGIN
  SELECT string_to_array(name, '/') INTO v_parts;
  RETURN v_parts[1 : array_length(v_parts, 1) - 1];
END;
$$;

CREATE TABLE IF NOT EXISTS storage.objects (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id  TEXT,
  name       TEXT,
  owner      UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  metadata   JSONB
);

-- On by default, exactly as Supabase ships it. With RLS on and no policy,
-- authenticated reads nothing - which is the state A2 not landing leaves the
-- harness in, and the reason the cross-tenant control below cannot yet be
-- scored as a pass.
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA storage TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT SELECT ON storage.objects TO anon;

DELETE FROM storage.objects WHERE bucket_id = 'vault';

INSERT INTO storage.objects (bucket_id, name, owner, metadata)
VALUES
  -- Acme's object. Its path names Acme's organization id, and its content hash
  -- is the kind of value a member of Umbrella can already read out of their own
  -- file list if the two tenants ever share a part.
  ('vault',
   'aaaaaaaa-0000-4000-8000-000000000001/ab/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
   'aaaaaaaa-1111-4000-8000-000000000001',
   '{"size": 4096, "mimetype": "application/octet-stream", "harness": "acme"}'::jsonb),
  -- Umbrella's object, so a control can tell "reads nothing" from "reads only
  -- its own".
  ('vault',
   'bbbbbbbb-0000-4000-8000-000000000001/cd/cdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab',
   'bbbbbbbb-1111-4000-8000-000000000001',
   '{"size": 8192, "mimetype": "application/octet-stream", "harness": "umbrella"}'::jsonb);

SELECT bucket_id,
       (storage.foldername(name))[1] AS owning_org,
       metadata ->> 'harness'        AS tenant
  FROM storage.objects
 ORDER BY 2;
