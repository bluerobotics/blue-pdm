-- A cross-tenant share link, alive, on a database that has already been fixed.
--
-- This is the residue class, and it is the one every release before this one
-- was blind to. The hole that minted rows like this was closed in v92; the row
-- it minted kept working, because the fix made validation resolve the
-- organization from the file and the file genuinely is in that organization.
-- Verification returned stamped: true over it.
--
-- Alice is an Acme member. The link is filed under Acme and points at an
-- Umbrella file, which is exactly what create_file_share_link produced when it
-- believed the p_org_id it was handed. Nothing in the schema's *code* is wrong
-- here - that is the point of the control. The verifier has to refuse on the
-- state of the data.
--
-- The repair is nc12-remediate.sql, which runs the remediation the verifier
-- names in its own output. If check_release_residue() were keying on the row's
-- existence rather than on it being live, the repair would not restore the
-- stamp, because remediation deactivates and keeps rather than deletes.
INSERT INTO file_share_links (org_id, file_id, token, created_by, expires_at,
                              max_downloads, download_count, require_auth, is_active)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001',   -- Acme, the minter
        'bbbbbbbb-3333-4000-8000-000000000001',   -- Umbrella's file
        'nc12000000cross0000tenant0000link',
        'aaaaaaaa-1111-4000-8000-000000000001',
        NOW() + INTERVAL '7 days', 10, 0, false, true)
ON CONFLICT (token) DO UPDATE SET is_active = true;
