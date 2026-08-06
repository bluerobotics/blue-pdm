-- A PROCEDURE in public that anon can CALL.
--
-- THE CONTROL THAT WAS MISSING
--
-- NC4 creates a function, and every part of the release before this one that
-- looked at routines split on prokind. check_anon_reach() had no filter and
-- reported this. enforce_anon_execute_posture() filtered prokind = 'f' and did
-- not touch it, and `REVOKE EXECUTE ON FUNCTION` would not have reached it
-- anyway - FUNCTION covers functions, aggregates and window functions, and
-- procedures need ROUTINE.
--
-- So a procedure added by a later migration made the verifier report a blocking
-- condition, the sweep the verifier told the operator to run answer "0 objects
-- changed", and the database unstampable for ever. That is the defect v90 had,
-- moved to a new place rather than fixed: a refusal with no way out.
--
-- This control therefore does two things NC4 does not. It requires the verifier
-- to catch the procedure, and then it repairs by running the remedy the
-- verifier prints - not by dropping the procedure. The stamp has to come back
-- with the procedure still there. Anything less proves the check works and
-- leaves the operator exactly as stuck.
CREATE OR REPLACE PROCEDURE nc_open_procedure(p_anything TEXT DEFAULT NULL)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RAISE NOTICE 'anon called a procedure in public';
END;
$$;

GRANT EXECUTE ON ROUTINE nc_open_procedure(TEXT) TO anon;
