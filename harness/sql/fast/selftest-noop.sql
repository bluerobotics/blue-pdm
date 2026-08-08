-- A file that changes nothing, used by -SelfTest in two roles.
--
-- As a hole (ST1): the verifier has nothing to catch, so the control must report
-- NOT CAUGHT. If the runner reports it as caught, then "caught" does not depend
-- on the database and every pass in the suite is an artefact of the scoring
-- code. This is the case that distinguishes a working Test-Caught from one that
-- returns true unconditionally - which is the failure the whole self-test exists
-- to rule out, and the one no amount of green runs would have revealed.
--
-- As a repair (ST4): the hole is real and still open afterwards, so the second
-- verification must still refuse and the control must report the repair as
-- ineffective.
--
-- It has to be a real file that applies cleanly - "the file was missing" is a
-- different failure with a different message, and ST3 covers that one by
-- pointing at a path this directory deliberately does not contain.

SELECT 'selftest-noop: applied, changed nothing' AS note;
