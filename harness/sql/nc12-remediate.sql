-- The repair for NC12: run the remediation, exactly as the verifier prints it.
--
-- Not a DELETE. The whole design of the remediation is that it deactivates and
-- keeps, so that the token, the creator and the timestamps survive for an audit
-- and an operator can restore a link they judge legitimate. If this restores the
-- stamp, then check_release_residue() is asking whether the credential is live
-- rather than whether the row exists, which is the distinction the release
-- depends on.
SELECT remediate_cross_tenant_share_links();
