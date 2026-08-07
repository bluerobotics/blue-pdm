-- The repair for NC16 is the remedy the verifier prints, not a DROP.
--
-- That is the interesting half. A check that reports a column grant while the
-- sweep can only see table grants is a blocking condition the operator cannot
-- clear by running what they are told to run - which is precisely the v90
-- defect this project spent two releases removing. The view is left in place
-- and the stamp has to come back.
SELECT enforce_anon_execute_posture();
