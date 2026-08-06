-- The repair for NC6 is the remedy the verifier prints, word for word, and
-- nothing else. The procedure stays where it is.
--
-- This is the whole control. Under the previous release the verifier reported
-- the procedure, printed this line as the fix, and this line changed nothing -
-- the sweep filtered prokind = 'f' and returned 0. The operator was left with a
-- refusal, a remedy that did not work, and no other lever.
SELECT enforce_anon_execute_posture() AS routines_closed;
