# Negative controls for the verifier.
#
# A verifier that passes is only meaningful if it can fail. Both previous
# releases shipped verification that reported success over a database with the
# holes wide open, so proving the checks pass on fixed code proves nothing on
# its own. Each control below reintroduces one hole, requires verification to
# refuse the stamp AND to name the right reason, then removes the hole and
# requires the stamp to come back.
#
# The "and name the right reason" part matters: a control that fails for some
# incidental reason - a syntax error in the hole, a missing table - would
# otherwise look like a pass, which is the exact mistake this whole exercise is
# about.
#
# THE RELEASE NUMBER IS DERIVED, NOT PINNED
#
# This file used to carry `$RELEASE = 93` as a literal. The schema moved to 94
# and the literal did not, so the baseline sanity check below - which requires
# the database to verify clean before any control runs - compared 94 against 93,
# printed "the database does not verify clean before the controls start" and
# exited 2. Every one of NC1 to NC17 was skipped from that moment on, and the
# message named the wrong culprit: the database verified perfectly, and it was
# this script that was two releases stale.
#
# So the expected release is read from schema_release_version(), which is the
# single place core.sql says the release number lives and the same value
# verify-schema.sql stamps. A pin cannot go stale if there is no pin.
#
# -ExpectRelease is for a caller that wants the number asserted as well - CI, or
# an operator checking that the tree under test is the release they think it is.
# It fails loudly, by name, and says which two numbers disagreed. It does not
# silently substitute its own.
#
param(
  [int]$ExpectRelease = 0
)

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

function Psql {
  param([string]$Sql, [string]$File, [string]$AsRole = 'postgres')
  if ($File) {
    docker compose exec -T -e PGPASSWORD=postgres db `
      psql -v ON_ERROR_STOP=1 --no-psqlrc -U $AsRole -d postgres -h 127.0.0.1 -f $File 2>&1 | Out-String
  } else {
    docker compose exec -T -e PGPASSWORD=postgres db `
      psql -v ON_ERROR_STOP=1 --no-psqlrc -U $AsRole -d postgres -h 127.0.0.1 -c $Sql 2>&1 | Out-String
  }
}

# One value, unaligned and unheadered, as a trimmed string. Empty when the query
# produced no row or psql failed - callers decide what that means rather than
# having a cast throw here.
function Get-Scalar {
  param([string]$Sql)
  $v = docker compose exec -T -e PGPASSWORD=postgres db `
    psql -tAq --no-psqlrc -U postgres -d postgres -h 127.0.0.1 -c $Sql 2>&1 | Out-String
  return $v.Trim()
}

# The release the installed schema declares for itself, or $null if the schema
# is not installed at all. Those are different faults and the caller says so.
function Get-DeclaredRelease {
  # Asked in two steps because a missing function is resolved at parse time: a
  # single query guarded by an EXISTS would still fail to plan.
  if ((Get-Scalar "SELECT to_regprocedure('schema_release_version()') IS NOT NULL") -ne 't') {
    return $null
  }
  $v = Get-Scalar 'SELECT schema_release_version()'
  if ($v -notmatch '^\d+$') { return $null }
  return [int]$v
}

# -1 rather than an exception when the stamp is missing or unreadable: the
# controls below use "did not advance" as a signal, and a PowerShell cast error
# in the middle of one would read as the harness breaking rather than as the
# verifier withholding a stamp.
function Get-StampedVersion {
  $v = Get-Scalar 'SELECT version FROM schema_version WHERE id = 1'
  if ($v -notmatch '^-?\d+$') { return -1 }
  return [int]$v
}

function Invoke-Verify {
  docker compose exec -T -e PGPASSWORD=postgres db `
    psql --no-psqlrc -U postgres -d postgres -h 127.0.0.1 -f /blueplm/tools/verify-schema.sql 2>&1 | Out-String
}

$script:Failures = @()
# Controls that actually executed. A suite that skipped everything and exited 0
# is the failure mode this file spent two releases in; the count is printed at
# the end so "OK" can never be read without it.
$script:Ran = 0

function Test-Control {
  param(
    [string]$Id,
    [string]$What,
    [string]$HoleFile,      # SQL that reintroduces the hole
    # Every one of these must appear in the refusal. More than one because a
    # status alone - 'anon-reachable' - does not say WHICH object was caught,
    # and three of the controls added in this release are different shapes of
    # the same status: a control that passed on somebody else's row would be
    # reporting a check that works for a case it does not cover.
    [string[]]$ExpectToken,
    [string[]]$RepairFiles, # module files that put it back
    # Run after the repair has been verified. For a control whose repair is the
    # remedy rather than a removal - NC6 repairs by running the sweep, leaving
    # the procedure in place - this is what takes the object away afterwards.
    [string[]]$CleanupFiles,
    [string]$HoleRole = 'postgres'
  )
  Write-Host "`n--- $Id  $What" -ForegroundColor Cyan
  $script:Ran = $script:Ran + 1

  # Start from a known stamped state so "did not advance" is unambiguous.
  Psql -Sql "UPDATE schema_version SET version = 0 WHERE id = 1" | Out-Null

  $applied = Psql -File $HoleFile -AsRole $HoleRole
  # -cmatch, and the colon, because -match is case-insensitive in PowerShell and
  # psql writes NOTICEs to stderr, which PowerShell renders as an ErrorRecord
  # ending in "FullyQualifiedErrorId : NativeCommandError". Every hole file that
  # emitted a single NOTICE - a DROP ... IF EXISTS on something absent - was
  # therefore reported as having failed to apply, when it had applied perfectly:
  # three of the controls added in this release were scored that way, and
  # because a hole that "did not apply" is neither repaired nor cleaned up, the
  # objects stayed behind and every control after them failed too. `ERROR:` in
  # capitals with the colon is psql's own prefix and nothing else produces it.
  if ($applied -cmatch 'ERROR:') {
    Write-Host "  hole did not apply:" -ForegroundColor Red
    Write-Host $applied
    $script:Failures += "$Id (hole failed to apply)"
    return
  }

  $out = Invoke-Verify
  $version = Get-StampedVersion
  $refused = ($out -match 'Schema verification failed')
  $missing = @($ExpectToken | Where-Object { $out -notmatch [regex]::Escape($_) })
  $named   = ($missing.Count -eq 0)
  $tokens  = ($ExpectToken -join "' + '")

  if ($refused -and $named -and $version -eq 0) {
    Write-Host "  caught: stamp withheld, version still 0, reason mentions '$tokens'" -ForegroundColor Green
  } else {
    Write-Host ("  NOT CAUGHT: refused={0} missing from the refusal: '{1}' version={2}" -f `
      $refused, ($missing -join "', '"), $version) -ForegroundColor Red
    ($out -split "`n" | Select-String -Pattern 'WARNING|ERROR|NOTICE' | Select-Object -First 12) | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    $script:Failures += "$Id (hole not caught)"
  }

  # Repair, and require the stamp to come back. This proves the control is
  # reversible and that the check is reacting to the hole and not to damage the
  # hole happened to cause.
  foreach ($f in $RepairFiles) { Psql -File $f | Out-Null }
  $out2 = Invoke-Verify
  $v2 = Get-StampedVersion
  if ($v2 -eq $RELEASE) {
    Write-Host "  repaired: stamped again at $v2" -ForegroundColor Green
  } else {
    Write-Host "  REPAIR FAILED: version is $v2, expected $RELEASE" -ForegroundColor Red
    ($out2 -split "`n" | Select-String -Pattern 'WARNING|ERROR' | Select-Object -First 12) | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    $script:Failures += "$Id (repair failed)"
  }

  foreach ($f in $CleanupFiles) { Psql -File $f | Out-Null }
}

Write-Host "=== NEGATIVE CONTROLS ===" -ForegroundColor Yellow

# Three faults, three messages. Conflating them is what cost this suite two
# releases of coverage.
$RELEASE = Get-DeclaredRelease
if ($null -eq $RELEASE) {
  Write-Host "ABORT: schema_release_version() is not installed on this database, so there is no release for the controls to be measured against. Run .\reset.ps1 first." -ForegroundColor Red
  exit 2
}
if ($ExpectRelease -gt 0 -and $RELEASE -ne $ExpectRelease) {
  Write-Host ("ABORT: RELEASE MISMATCH - schema_release_version() says {0}, -ExpectRelease says {1}. The tree under test is not the release you asked for; nothing below would be measuring it." `
    -f $RELEASE, $ExpectRelease) -ForegroundColor Red
  exit 2
}

# Sanity: we must start from a database that verification accepts. Otherwise
# every control below "fails verification" for free. Now that $RELEASE comes
# from the schema rather than from a literal, a failure here really is the
# database and not the pin.
Invoke-Verify | Out-Null
$stamped = Get-StampedVersion
if ($stamped -ne $RELEASE) {
  Write-Host ("ABORT: the database does not verify clean before the controls start - schema_release_version() declares {0} and schema_version holds {1}." `
    -f $RELEASE, $(if ($stamped -lt 0) { 'nothing readable' } else { $stamped })) -ForegroundColor Red
  Invoke-Verify | Select-String -Pattern 'WARNING|ERROR' | Select-Object -First 20
  exit 2
}
Write-Host "baseline verifies clean at $RELEASE (read from schema_release_version())" -ForegroundColor Green

Test-Control -Id 'NC1' -What 'finding 2: parts_with_pricing as a plain view, readable by anon' `
  -HoleFile '/sql/nc1-view-open.sql' -ExpectToken 'anon-reachable' `
  -RepairFiles @('/blueplm/modules/30-supply-chain.sql')

Test-Control -Id 'NC2' -What 'finding 3: create_file_share_link gating p_org_id, acting on p_file_id' `
  -HoleFile '/sql/nc2-unbound-file-arg.sql' -ExpectToken 'unbound-entity-arg' `
  -RepairFiles @('/blueplm/modules/10-source-files.sql')

Test-Control -Id 'NC3' -What 'finding 4: NOT IN (SELECT org_id FROM users ...)' `
  -HoleFile '/sql/nc3-null-unsafe-gate.sql' -ExpectToken 'null-unsafe-gate' `
  -RepairFiles @('/sql/nc3-drop.sql')

Test-Control -Id 'NC4' -What 'a function created later, born anon-executable' `
  -HoleFile '/sql/nc4-born-open.sql' -ExpectToken 'anon-reachable' `
  -RepairFiles @('/sql/nc4-drop.sql')

Test-Control -Id 'NC5' -What 'a leftover overload from a previous release' `
  -HoleFile '/sql/nc5-leftover-overload.sql' -ExpectToken 'extra' `
  -RepairFiles @('/sql/nc5-drop.sql')

# NC6 repairs by running the remedy, not by removing the hole. That is the
# control: v90's defect was a blocking condition the operator could not clear,
# and this release relocated it to procedures rather than fixing it. The stamp
# has to come back with the procedure still sitting in public.
Test-Control -Id 'NC6' -What 'a PROCEDURE in public that anon can call, cleared by the remedy the verifier prints' `
  -HoleFile '/sql/nc6-procedure-open.sql' -ExpectToken 'anon-reachable' `
  -RepairFiles @('/sql/nc6-run-remedy.sql') -CleanupFiles @('/sql/nc6-drop.sql')

Test-Control -Id 'NC8' -What 'a materialized view in public, readable by authenticated' `
  -HoleFile '/sql/nc8-matview.sql' -ExpectToken 'materialized view' `
  -RepairFiles @('/sql/nc8-drop.sql')

Test-Control -Id 'NC9' -What 'the NULL-unsafe membership test in four other spellings' `
  -HoleFile '/sql/nc9-null-unsafe-alt.sql' -ExpectToken 'null-unsafe-gate' `
  -RepairFiles @('/sql/nc9-drop.sql')

Test-Control -Id 'NC10' -What 'a function with no authorization that refuses the probe for another reason' `
  -HoleFile '/sql/nc10-ungated.sql' -ExpectToken 'ungated' `
  -RepairFiles @('/sql/nc10-fix.sql') -CleanupFiles @('/sql/nc10-drop.sql')

Test-Control -Id 'NC11' -What 'two entity ids, one checked, and no p_org_id anywhere' `
  -HoleFile '/sql/nc11-entity-gated.sql' -ExpectToken 'unbound-entity-arg' `
  -RepairFiles @('/sql/nc11-fix.sql') -CleanupFiles @('/sql/nc11-drop.sql')

# ---------------------------------------------------------------------------
# The controls this release adds. The first is a different kind of control from
# everything above it: the schema is correct and the DATA is not.
# ---------------------------------------------------------------------------

# Repaired by running the remediation, not by deleting the row - the remediation
# deactivates and keeps, so if this restores the stamp then residue is being
# judged on whether the credential is live rather than on whether a row exists.
Test-Control -Id 'NC12' -What 'a live cross-tenant share link left over from a release that closed the hole' `
  -HoleFile '/sql/nc12-residue-link.sql' `
  -ExpectToken @('cross_tenant_share_link', 'nc120000...') `
  -RepairFiles @('/sql/nc12-remediate.sql') -CleanupFiles @('/sql/nc12-drop.sql')

Test-Control -Id 'NC13' -What 'no authorization at all, with auth.uid() as the only identity-shaped line' `
  -HoleFile '/sql/nc13-actor-stamp.sql' -ExpectToken @('ungated', 'nc_actor_stamp_only') `
  -RepairFiles @('/sql/nc13-fix.sql') -CleanupFiles @('/sql/nc13-drop.sql')

Test-Control -Id 'NC14' -What 'a partitioned table whose leaf has RLS and whose parent does not' `
  -HoleFile '/sql/nc14-partitioned.sql' -ExpectToken @('anon-reachable', 'nc_partitioned_parts') `
  -RepairFiles @('/sql/nc14-drop.sql')

Test-Control -Id 'NC15' -What 'RLS enabled and a policy that admits anon to every row' `
  -HoleFile '/sql/nc15-rls-admits-anon.sql' `
  -ExpectToken @('anon-reachable', 'nc_rls_but_open', 'admits anon to every') `
  -RepairFiles @('/sql/nc15-drop.sql')

# Repaired by the sweep rather than by a DROP, for the same reason NC6 is: a
# reported condition the printed remedy cannot clear is the defect this project
# spent two releases removing.
Test-Control -Id 'NC16' -What 'a view anon can read one column of' `
  -HoleFile '/sql/nc16-column-grant-view.sql' `
  -ExpectToken @('anon-reachable', 'nc_column_grant_view') `
  -RepairFiles @('/sql/nc16-run-remedy.sql') -CleanupFiles @('/sql/nc16-drop.sql')

Test-Control -Id 'NC17' -What 'consume_share_link restating validate_share_link''s conditions instead of calling it' `
  -HoleFile '/sql/nc17-consume-restated.sql' `
  -ExpectToken @('stale', 'consume_share_link') `
  -RepairFiles @('/blueplm/modules/10-source-files.sql')

# ---------------------------------------------------------------------------
# NC7 is the other direction, and it needs its own test.
#
# Every control above requires the verifier to REFUSE. This one requires it to
# report loudly and stamp anyway, because the object is one no project role can
# revoke - and a verifier that withholds the stamp for a condition the operator
# cannot clear is the v90 defect, whatever it is protecting.
#
# Getting that wrong in either direction is fatal: silence would hide a live
# anon entry point, and refusal would brick the project.
# ---------------------------------------------------------------------------
Write-Host "`n--- NC7  a function in public owned by supabase_admin, which postgres cannot revoke" -ForegroundColor Cyan

Psql -Sql "UPDATE schema_version SET version = 0 WHERE id = 1" | Out-Null
$applied = Psql -File '/sql/nc7-unrevokable.sql' -AsRole 'supabase_admin'
if ($applied -match 'ERROR') {
  Write-Host "  hole did not apply:" -ForegroundColor Red; Write-Host $applied
  $script:Failures += 'NC7 (hole failed to apply)'
} else {
  # The premise: postgres genuinely cannot take this away. Without checking it,
  # "advisory" would be a claim rather than a fact.
  $tryRevoke = Psql -Sql "REVOKE EXECUTE ON FUNCTION public.nc_unrevokable(TEXT) FROM anon, PUBLIC"
  $stillThere = (Psql -Sql "SELECT has_function_privilege('anon','public.nc_unrevokable(text)','EXECUTE')") -match 't'

  $out = Invoke-Verify
  $version = Get-StampedVersion
  $reported  = ($out -match 'nc_unrevokable')
  $advisory  = ($out -match 'advisory')
  $refused   = ($out -match 'Schema verification failed')

  if ($stillThere -and $reported -and $advisory -and -not $refused -and $version -eq $RELEASE) {
    Write-Host "  correct: postgres could not revoke it, it is reported by name as advisory, and the stamp was still granted" -ForegroundColor Green
  } else {
    Write-Host ("  WRONG: anon still has it={0} reported={1} advisory={2} stamp withheld={3} version={4}" -f `
      $stillThere, $reported, $advisory, $refused, $version) -ForegroundColor Red
    if (-not $stillThere) { Write-Host "    postgres was able to revoke it, so this is not the condition being tested: $tryRevoke" -ForegroundColor DarkGray }
    ($out -split "`n" | Select-String -Pattern 'nc_unrevokable|Schema NOT stamped' | Select-Object -First 6) |
      ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    $script:Failures += 'NC7 (unrevokable object graded wrongly)'
  }

  Psql -File '/sql/nc7-drop.sql' -AsRole 'supabase_admin' | Out-Null
  Invoke-Verify | Out-Null
}

# ---------------------------------------------------------------------------
# Posture checks: the things no HTTP request can see.
# ---------------------------------------------------------------------------
Write-Host "`n--- POSTURE CHECKS" -ForegroundColor Cyan
$posture = Psql -File '/sql/posture-checks.sql'
if ($posture -match 'POSTURE CHECKS PASSED') {
  # psql writes NOTICE to stderr, PowerShell renders each stderr record as an
  # ErrorRecord - prefixed with the command name and hard-wrapped at the console
  # width. Collapsing the whitespace first is what keeps a captured run from
  # showing half a sentence.
  $flat = ($posture -replace '\s+', ' ')
  [regex]::Matches($flat, 'PASS - [^.]+\.') | ForEach-Object { Write-Host ("  " + $_.Value) -ForegroundColor Green }
} else {
  Write-Host $posture -ForegroundColor Red
  $script:Failures += 'posture checks'
}

# The database must still verify clean at the end, or one of the controls left
# damage behind and every later run starts from a lie.
Invoke-Verify | Out-Null
if ((Get-StampedVersion) -ne $RELEASE) {
  Write-Host "`nFAIL: the database no longer verifies clean after the controls ran." -ForegroundColor Red
  Invoke-Verify | Select-String -Pattern 'WARNING|ERROR' | Select-Object -First 20
  $script:Failures += 'left the database dirty'
}

if ($script:Ran -eq 0) {
  Write-Host "`nFAIL: no control executed. A suite that runs nothing cannot report success." -ForegroundColor Red
  $script:Failures += 'no control executed'
}

Write-Host ""
if ($script:Failures.Count -gt 0) {
  Write-Host ("FAIL: {0}" -f ($script:Failures -join '; ')) -ForegroundColor Red
  exit 1
}
Write-Host ("OK: {0} controls executed at release {1}. Every hole was caught by the verifier, the one nobody can fix was reported without blocking, and the database still verifies clean." `
  -f $script:Ran, $RELEASE) -ForegroundColor Green
exit 0
