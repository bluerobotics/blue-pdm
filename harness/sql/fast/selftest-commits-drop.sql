-- Teardown for ST5, and the reason -SelfTest is not something to run casually
-- against a database somebody else is using.
--
-- ST5's hole commits itself on purpose, so two things outlive it: the table, and
-- the `UPDATE schema_version SET version = 0` that every control opens with -
-- which was inside the same transaction the hole committed. The database is left
-- carrying a stamp of 0, which is indistinguishable from "verification last
-- refused".
--
-- Dropping the table restores the catalogue. Re-running the verification
-- restores the stamp, and does it the only way anything is allowed to: by
-- verifying. verify_and_stamp_schema() is the function that owns that write -
-- nothing else in the tree may stamp - so calling it here is not a shortcut past
-- the check, it is the check.
--
-- It reports its own verdict: {"stamped": true, ...} means the database came
-- back clean and the version was written, and anything else carries the problem
-- list that says why not. Raising on that makes it the self-test's verdict
-- rather than a line in the log that scrolls past.

DROP TABLE IF EXISTS public.harness_fast_selftest_committed;

DO $$
DECLARE
  v_result JSON;
  v_stamp  INTEGER;
BEGIN
  v_result := verify_and_stamp_schema();

  IF NOT COALESCE((v_result->>'stamped')::BOOLEAN, FALSE) THEN
    RAISE EXCEPTION 'Self-test teardown: the database did not come back clean, so the stamp was withheld. %',
      v_result->>'problems';
  END IF;

  SELECT version INTO v_stamp FROM schema_version WHERE id = 1;
  IF v_stamp IS DISTINCT FROM schema_release_version() THEN
    RAISE EXCEPTION 'Self-test teardown: verification reported stamped, but schema_version reads % and the release is %.',
      COALESCE(v_stamp::TEXT, 'NULL'), schema_release_version();
  END IF;

  RAISE NOTICE 'Self-test teardown: database restored, schema_version stamped %.', v_stamp;
END $$;
