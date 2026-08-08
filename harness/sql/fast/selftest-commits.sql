-- A hole that escapes the transaction it was applied in (ST5).
--
-- WHAT IS BEING TESTED, AND WHY IT IS THE LOAD-BEARING ONE
--
-- -Tier standard and -Tier smoke replace the original suite's repair-and-verify
-- -again step with BEGIN / apply / verify / ROLLBACK, on the argument that a
-- rollback restores the catalogue exactly and therefore the state the next
-- control runs against is the state the baseline verified clean. Everything
-- those tiers claim rests on that.
--
-- The comparison that enforces it is harness_fast.catalog_signature(), taken
-- after every rollback and required to equal the baseline. But a comparison of
-- two values that are always equal passes whether or not it is looking at
-- anything, and a signature function with a mistake in it - a WHERE clause that
-- excludes the rows that changed, an aggregate over an empty set - is exactly
-- that. Unverified, the signature check is decoration.
--
-- So this file makes a change the rollback cannot undo, and the self-test
-- requires the comparison to catch it. If it does not, -Tier standard is
-- unsound and the run says so instead of reporting a fast, clean suite.
--
-- HOW IT ESCAPES
--
-- COMMIT ends the transaction the runner opened, so the CREATE TABLE lands for
-- good; the BEGIN at the end re-opens one so the runner's ROLLBACK still has a
-- transaction to roll back and the script that follows is unchanged. This is
-- also not merely hypothetical: any hole file that contained its own COMMIT, or
-- a CREATE INDEX CONCURRENTLY, or a call into dblink or a background worker,
-- would do the same thing by accident. The self-test is checking that such a
-- file is detected rather than trusted.
--
-- The table is created in public because that is where the signature looks.
-- Something left in harness_fast would be invisible to it, and inventing a
-- change the check cannot see would test nothing.

COMMIT;

CREATE TABLE IF NOT EXISTS public.harness_fast_selftest_committed (
  note TEXT PRIMARY KEY
);
INSERT INTO public.harness_fast_selftest_committed (note)
VALUES ('If this table is in the database, sql/fast/selftest-commits-drop.sql did not run.')
ON CONFLICT (note) DO NOTHING;

BEGIN;
