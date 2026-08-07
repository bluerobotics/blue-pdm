-- Put the database back into the state the emergency lockdown exists to end.
--
-- WHY THIS FILE EXISTS
--
-- capture-evidence.ps1 said, in a comment, that it captured the lockdown
-- "against a database that has just been put back into the open state -
-- otherwise the run proves only that it is a no-op on a database already
-- closed". Nothing put it back. evidence/06-lockdown.txt reads
--
--   Revoked EXECUTE from anon on 0 function(s)
--   Revoked anon access to 0 view(s) and materialized view(s)
--
-- which is exactly the no-op the comment warned about, published as the
-- evidence that the script works. This file makes the comment true.
--
-- WHAT IT RECREATES, AND WHY EACH PART
--
--   1. EXECUTE on every routine in public, to anon. This is not a contrivance:
--      Supabase's bootstrap runs ALTER DEFAULT PRIVILEGES ... GRANT ALL ON
--      FUNCTIONS TO ... anon, so every function created in public is born with
--      it. It is the condition the lockdown was written for and the one
--      production is in today.
--   2. A view anon can read one column of. The plain-view leak is what the
--      script's own header cites (parts_with_pricing), and the column-level
--      form is the one has_table_privilege could not see. Both are the same
--      exposure to PostgREST.
--
-- Safe to run only against the harness. It deliberately opens the database.
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO anon;

DROP VIEW IF EXISTS evidence_open_view;

CREATE VIEW evidence_open_view WITH (security_invoker = true) AS
  SELECT f.id, f.org_id, f.part_number, f.description
  FROM files f;

REVOKE ALL ON evidence_open_view FROM anon;
GRANT SELECT (part_number) ON evidence_open_view TO anon;
