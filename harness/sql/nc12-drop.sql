-- Take the control's row and its ledger entry back out, so the next run starts
-- from the same database this one did.
DELETE FROM file_share_links WHERE token = 'nc12000000cross0000tenant0000link';
DELETE FROM schema_remediation_log
 WHERE remediation = 'cross_tenant_share_links'
   AND subjects::text LIKE '%nc12000000cross0000tenant0000link%';
