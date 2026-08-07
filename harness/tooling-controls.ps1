# Negative controls for the verification tooling itself.
#
# WHY THIS IS A SEPARATE FILE FROM negative-controls.ps1
#
# negative-controls.ps1 proves that tools/verify-schema.sql refuses a database
# with a hole in it. Nothing proved the same thing about the other two verifiers
# in this repository, and both of them turned out to certify the exact hole they
# were written to catch:
#
#   * tools/emergency-lockdown.sql printed "PASS - ... no view is [readable by
#     anon]" over a view serving both tenants' part numbers to anon through a
#     column-level grant, and reached its PASS by counting anon-executable
#     routines against the number three rather than by asking whether they were
#     the three on its allowlist.
#   * sql/repair-config-maps-proof.sql's case 23, documented as the sentinel
#     that proves the suite can tell a working function from an inert one, never
#     called the function.
#   * sql/uuid-default-census.sql, in the middle of measuring an upgrade lane,
#     performed the migration it was measuring.
#
# Each control below reintroduces one of those conditions and requires the fixed
# tool to catch it. A control is only worth the run it costs if it would fail
# against the unfixed tool, so every one of them also asserts its own premise
# first - that the condition is really there, and that the old predicate really
# was blind to it.
#
# HOW TO SHOW THESE FAIL WHEN THE FIX IS REVERTED
#
# -LockdownScript points at the copy of the script under test. Write the
# pre-fix version somewhere the container can see and run the suite against it:
#
#   git show <commit>:supabase/tools/emergency-lockdown.sql |
#     Set-Content harness\sql\_pre-fix-lockdown.sql -Encoding utf8
#   .\tooling-controls.ps1 -LockdownScript /sql/_pre-fix-lockdown.sql -Only LC1,LC2,LC3
#
# LC1, LC2 and LC3 must all fail on that run. If they do not, they are not
# controls.
#
# PREREQUISITES
#
#   .\reset.ps1     # a freshly installed release, seeded
#
# This script changes grants and creates objects, and puts every one of them
# back. It ends by requiring the database to verify clean, so a control that
# leaves damage behind is reported rather than inherited by the next run.
param(
  [string]$LockdownScript = '/blueplm/tools/emergency-lockdown.sql',
  # Control ids to run. Empty means all of them.
  [string[]]$Only = @()
)

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

# STDERR IS MERGED INSIDE THE CONTAINER, NOT IN POWERSHELL
#
# psql writes NOTICE and WARNING to stderr. Left to PowerShell, each line
# arrives as an ErrorRecord, gets prefixed with the command name and hard
# wrapped at the console width - which breaks long identifiers across lines and
# makes -match on an object name unreliable. `bash -c '... 2>&1'` merges the two
# streams before they leave the container, so what comes back is what psql
# wrote. capture-evidence.ps1 solves the same problem by copying a file out; the
# merge is enough here because nothing is being saved.
#
# SQL GOES IN ON STDIN, NOT IN -c
#
# The obvious form - bash -c "psql ... -c `"$Sql`"" - does not survive the trip.
# PowerShell re-quotes each argument on its way to a native command and does not
# escape double quotes inside one, so the argument splits at the first `"` and
# psql is handed a fragment. It fails *silently*: every caller gets an empty
# string back, which Get-Scalar's callers read as "the object is not there".
# Every premise assertion below would have been answered by a question that was
# never asked. psql with no -c and no -f reads its script from stdin, and the
# bash string then contains no quotes at all, so there is nothing to mangle.
function Invoke-Psql {
  param([string]$Sql, [string]$File, [string]$AsRole = 'postgres')
  if ($File) {
    return (docker compose exec -T -e PGPASSWORD=postgres -e PGCLIENTENCODING=UTF8 db `
              bash -c "psql --no-psqlrc -U $AsRole -d postgres -h 127.0.0.1 -f '$File' 2>&1" | Out-String)
  }
  return ($Sql | docker compose exec -T -e PGPASSWORD=postgres -e PGCLIENTENCODING=UTF8 db `
            bash -c "psql -v ON_ERROR_STOP=1 --no-psqlrc -U $AsRole -d postgres -h 127.0.0.1 2>&1" | Out-String)
}

function Get-Scalar {
  param([string]$Sql, [string]$AsRole = 'postgres')
  $value = $Sql | docker compose exec -T -e PGPASSWORD=postgres db `
             bash -c "psql -tAq --no-psqlrc -U $AsRole -d postgres -h 127.0.0.1 2>/dev/null" | Out-String
  return $value.Trim()
}

# The hole files are applied with ON_ERROR_STOP so that a setup that did not
# take is reported as a setup failure rather than as a control that found
# nothing. `ERROR:` in capitals with the colon is psql's own prefix; -cmatch
# because -match is case-insensitive in PowerShell and several of these files
# emit an ordinary NOTICE.
function Invoke-Setup {
  param([string]$File, [string]$AsRole = 'postgres')
  $command = "psql -v ON_ERROR_STOP=1 --no-psqlrc -U $AsRole -d postgres -h 127.0.0.1 -f '$File' 2>&1"
  return (docker compose exec -T -e PGPASSWORD=postgres db bash -c $command | Out-String)
}

function Invoke-Lockdown { return (Invoke-Psql -File $LockdownScript) }
function Invoke-ProofSuite { return (Invoke-Psql -File '/sql/repair-config-maps-proof.sql') }
function Invoke-Census { return (Invoke-Psql -File '/sql/uuid-default-census.sql') }

$script:Failures = @()
$script:Ran = 0

function Check {
  param([string]$Id, [string]$What, [bool]$Ok, [string]$Evidence)
  if ($Ok) {
    Write-Host ("  [ok]      {0}" -f $What) -ForegroundColor Green
  } else {
    Write-Host ("  [FAILED]  {0}" -f $What) -ForegroundColor Red
    if ($Evidence) { Write-Host ("            {0}" -f $Evidence) -ForegroundColor DarkGray }
    $script:Failures += "$Id ($What)"
  }
}

# Reported, never counted as a pass. A control whose setup could not be built
# has not found anything, and saying so is the difference between this suite and
# the ones it was written to correct.
function Skip-Control {
  param([string]$Why)
  Write-Host ("  [n/a]     {0}" -f $Why) -ForegroundColor DarkGray
}

function Test-Wanted {
  param([string]$Id)
  if ($Only.Count -eq 0) { return $true }
  return ($Only -contains $Id)
}

function Start-Control {
  param([string]$Id, [string]$What)
  Write-Host "`n--- $Id  $What" -ForegroundColor Cyan
  $script:Ran = $script:Ran + 1
}

Write-Host "=== TOOLING CONTROLS ===" -ForegroundColor Yellow
Write-Host ("lockdown script under test: {0}" -f $LockdownScript) -ForegroundColor DarkGray

# The allowlist, restated here rather than parsed out of the SQL. If the two
# ever disagree that is itself worth knowing, and a control that read its
# expectation from the file it is checking would agree with it by construction.
$ALLOWLIST = @('get_org_auth_providers(text)', 'validate_share_link(text)', 'consume_share_link(text)')

function Get-AnonRoutineCount {
  return [int](Get-Scalar "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE')")
}

function Test-AllowlistIntact {
  $lost = @()
  foreach ($signature in $ALLOWLIST) {
    $reachable = Get-Scalar ("SELECT has_function_privilege('anon', '{0}', 'EXECUTE')" -f $signature)
    if ($reachable -ne 't') { $lost += $signature }
  }
  return $lost
}

# ---------------------------------------------------------------------------
# LC0 - the positive control, and it runs first.
#
# Everything below asks the lockdown to refuse something. Without this, a script
# that revoked EXECUTE from anon on every routine in public would satisfy all of
# them and take the sign-in screen down with it. get_org_auth_providers is
# called before anybody has signed in; validate_share_link and consume_share_link
# are how a recipient who is not a BluePLM user opens a shared file.
# ---------------------------------------------------------------------------
if (Test-Wanted 'LC0') {
  Start-Control -Id 'LC0' -What 'the lockdown passes a clean database and leaves the pre-login allowlist reachable'
  $out = Invoke-Lockdown
  Check -Id 'LC0' -What 'the check reports PASS on a database with nothing wrong with it' `
        -Ok ($out -match 'PASS - ') -Evidence (($out -split "`n" | Select-String -Pattern 'PASS|CHECK FAILED' | Select-Object -First 3) -join ' | ')
  $lost = Test-AllowlistIntact
  Check -Id 'LC0' -What 'all three pre-login routines are still executable by anon afterwards' `
        -Ok ($lost.Count -eq 0) -Evidence ("revoked by the lockdown: {0}" -f ($lost -join ', '))
}

# ---------------------------------------------------------------------------
# LC1 - a view anon can read one column of.
# ---------------------------------------------------------------------------
if (Test-Wanted 'LC1') {
  Start-Control -Id 'LC1' -What 'a column-granted view is swept, not stepped over'
  $applied = Invoke-Setup -File '/sql/lc1-column-grant-view.sql'
  if ($applied -cmatch 'ERROR:') {
    Check -Id 'LC1' -What 'the hole applied' -Ok $false -Evidence $applied
  } else {
    # The premise, both halves of it. Without the second assertion this control
    # would still pass against a script that had never been broken, and would
    # therefore not be evidence about the fix.
    Check -Id 'LC1' -What 'premise: anon can read a column of the view' `
          -Ok ((Get-Scalar "SELECT has_any_column_privilege('anon', 'lc_column_grant_view', 'SELECT')") -eq 't') -Evidence 'setup did not grant it'
    Check -Id 'LC1' -What 'premise: has_table_privilege is blind to that grant, which is why the old predicate missed it' `
          -Ok ((Get-Scalar "SELECT has_table_privilege('anon', 'lc_column_grant_view', 'SELECT')") -eq 'f') -Evidence 'the grant is table-level, so this control is not testing what it claims'

    $out = Invoke-Lockdown

    Check -Id 'LC1' -What 'the sweep revoked it' `
          -Ok ((Get-Scalar "SELECT has_any_column_privilege('anon', 'lc_column_grant_view', 'SELECT')") -eq 'f') `
          -Evidence 'anon can still read the column after the lockdown ran'
    Check -Id 'LC1' -What 'the report names the view' `
          -Ok ($out -match 'lc_column_grant_view') `
          -Evidence 'the view is absent from the lockdown output, so the operator was never told'

    Invoke-Setup -File '/sql/lc1-drop.sql' | Out-Null
  }
}

# ---------------------------------------------------------------------------
# LC2 - three anon-executable routines, and one of them is not on the allowlist.
# ---------------------------------------------------------------------------
if (Test-Wanted 'LC2') {
  Start-Control -Id 'LC2' -What 'the PASS gate checks which routines anon can execute, not how many'
  $applied  = Invoke-Setup -File '/sql/lc2-revoke-allowlisted.sql'
  $applied += Invoke-Setup -File '/sql/lc2-rogue-routine.sql' -AsRole 'supabase_admin'
  if ($applied -cmatch 'ERROR:') {
    Check -Id 'LC2' -What 'the hole applied' -Ok $false -Evidence $applied
  } else {
    $count = Get-AnonRoutineCount
    Check -Id 'LC2' -What 'premise: exactly three routines are anon-executable, which the old gate read as a pass' `
          -Ok ($count -eq 3) -Evidence ("count is {0}, so this run is not exercising the off-by-identity case" -f $count)

    $out = Invoke-Lockdown

    Check -Id 'LC2' -What 'the check refuses' `
          -Ok ($out -match 'CHECK FAILED') `
          -Evidence 'the lockdown reported PASS over a routine anon can call that nobody allowlisted'
    Check -Id 'LC2' -What 'the refusal names the routine' `
          -Ok ($out -match 'lc_rogue_anon_routine') `
          -Evidence 'the refusal does not say which routine, which is the half that makes it actionable'

    Invoke-Setup -File '/sql/lc2-drop.sql' -AsRole 'supabase_admin' | Out-Null
    Invoke-Setup -File '/sql/lc2-restore.sql' | Out-Null

    $lost = Test-AllowlistIntact
    Check -Id 'LC2' -What 'teardown put the allowlisted routine back' `
          -Ok ($lost.Count -eq 0) -Evidence ("still revoked: {0}" -f ($lost -join ', '))
  }
}

# ---------------------------------------------------------------------------
# LC3 - a partitioned table with no row-level security on the parent.
# ---------------------------------------------------------------------------
if (Test-Wanted 'LC3') {
  Start-Control -Id 'LC3' -What 'the RLS count covers every relation kind that can hold rows'
  $applied = Invoke-Setup -File '/sql/lc3-partitioned-no-rls.sql'
  if ($applied -cmatch 'ERROR:') {
    Check -Id 'LC3' -What 'the hole applied' -Ok $false -Evidence $applied
  } else {
    $ordinary = [int](Get-Scalar "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity")
    Check -Id 'LC3' -What "premise: the old relkind = 'r' predicate still counts zero" `
          -Ok ($ordinary -eq 0) -Evidence ("it counts {0}, so a pass here would not be about partitioned tables" -f $ordinary)

    $out = Invoke-Lockdown

    Check -Id 'LC3' -What 'the check refuses' `
          -Ok ($out -match 'CHECK FAILED') `
          -Evidence 'the lockdown reported every relation protected while the parent served rows to anyone'
    Check -Id 'LC3' -What 'the refusal names the relation' `
          -Ok ($out -match 'lc_partitioned_parts') `
          -Evidence 'a count without a name leaves the operator nothing to act on'

    Invoke-Setup -File '/sql/lc3-drop.sql' | Out-Null
  }
}

# ---------------------------------------------------------------------------
# LC4 - the census measures without migrating.
# ---------------------------------------------------------------------------
if (Test-Wanted 'LC4') {
  Start-Control -Id 'LC4' -What 'the uuid census leaves the defaults it counts exactly where they were'
  $applied = Invoke-Setup -File '/sql/lc4-census-scratch.sql'
  if ($applied -cmatch 'ERROR:') {
    Skip-Control -Why "uuid-ossp is not installable in this container, so there is nothing for a migration to move. Setup output: $($applied.Trim())"
  } elseif ((Get-Scalar "SELECT to_regprocedure('migrate_uuid_defaults()') IS NOT NULL") -ne 't') {
    Skip-Control -Why 'migrate_uuid_defaults() does not exist on this database'
    Invoke-Setup -File '/sql/lc4-drop.sql' | Out-Null
  } else {
    $countSql = "SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE n.nspname = 'public' AND NOT a.attisdropped AND pg_get_expr(d.adbin, d.adrelid) ~ 'uuid_generate_v4'"
    $before = [int](Get-Scalar $countSql)
    Check -Id 'LC4' -What 'premise: there is at least one uuid_generate_v4() default for a migration to move' `
          -Ok ($before -ge 1) -Evidence ("found {0}" -f $before)

    $out = Invoke-Census
    $after = [int](Get-Scalar $countSql)

    Check -Id 'LC4' -What 'the census asked the second-run question' `
          -Ok ($out -match 'SECOND RUN') `
          -Evidence 'the question was skipped, so nothing was measured and nothing could have been migrated either'
    Check -Id 'LC4' -What 'the census changed nothing' `
          -Ok ($after -eq $before) `
          -Evidence ("{0} uuid_generate_v4() default(s) before, {1} after - the census performed the migration it was measuring" -f $before, $after)

    Invoke-Setup -File '/sql/lc4-drop.sql' | Out-Null
  }
}

# ---------------------------------------------------------------------------
# LC5 - the repair proof suite can tell a crippled function from the real one.
# ---------------------------------------------------------------------------
# READ THE VERDICTS, NOT THE SUMMARY LINE
#
# This used to look for 'CASES PASSED', which the suite emits with
# RAISE NOTICE - and its own line 32 is `SET client_min_messages = warning`, so
# that notice never reaches the client and the check could never pass. It failed
# against a suite in which all 24 cases were passing, which is the same class of
# mistake as the three defects LC1-LC4 exist to catch: an assertion written
# against a signal the thing under test does not emit.
#
# The per-case verdicts are a better thing to read than a summary anyway. The
# suite prints one PASS or FAIL row per case and its final DO block raises an
# exception on any failure or on an incomplete run, so all three of these have
# to hold together.
#
# 'Activity logging failed' is filtered out of the evidence: record_activity()
# warns when auth.uid() is NULL, which it is for every case this suite runs as
# postgres. Six copies of it were crowding the real diagnosis out of the line.
function Test-ProofSuitePassed {
  param([string]$Output)
  return (($Output -notmatch '(?m)^\s*FAIL\s') -and
          ($Output -cnotmatch 'ERROR:') -and
          ($Output -match '\(24 rows\)'))
}

function Get-ProofSuiteEvidence {
  param([string]$Output)
  $lines = $Output -split "`n" |
             Where-Object { $_ -notmatch 'Activity logging failed' } |
             Select-String -Pattern '(?m)^\s*FAIL\s|ERROR:|rows\)' |
             Select-Object -First 6
  return (($lines | ForEach-Object { $_.ToString().Trim() }) -join ' | ')
}

if (Test-Wanted 'LC5') {
  Start-Control -Id 'LC5' -What 'the repair proof suite fails against a function that repairs only the first file'
  $clean = Invoke-ProofSuite
  Check -Id 'LC5' -What 'premise: the suite passes against the genuine function' `
        -Ok (Test-ProofSuitePassed $clean) `
        -Evidence (Get-ProofSuiteEvidence $clean)

  $applied = Invoke-Setup -File '/sql/lc5-repair-drop-after-first.sql'
  if ($applied -cmatch 'ERROR:') {
    Check -Id 'LC5' -What 'the mutant applied' -Ok $false -Evidence $applied
  } else {
    $mutant = Invoke-ProofSuite
    Check -Id 'LC5' -What 'the suite refuses the mutant' `
          -Ok ($mutant -match 'case\(s\) failed') `
          -Evidence 'a function that silently drops every repair after the first passed all of it'
    Check -Id 'LC5' -What 'and the case that catches it is the multi-file one' `
          -Ok ($mutant -match '24:') `
          -Evidence 'the mutant was caught by something other than case 24, so case 24 is not what is holding this line'

    Invoke-Setup -File '/sql/lc5-restore.sql' | Out-Null
    $restored = Invoke-ProofSuite
    Check -Id 'LC5' -What 'the genuine function is back and the suite passes again' `
          -Ok (Test-ProofSuitePassed $restored) `
          -Evidence (Get-ProofSuiteEvidence $restored)
  }
}

# ---------------------------------------------------------------------------
# Every control put its own objects back. If any did not, the next run of
# anything against this database starts from a lie.
# ---------------------------------------------------------------------------
Write-Host "`n--- AFTERWARDS" -ForegroundColor Cyan
$verify = Invoke-Psql -File '/blueplm/tools/verify-schema.sql'
Check -Id 'teardown' -What 'the database still verifies clean' `
      -Ok ($verify -notmatch 'Schema verification failed') `
      -Evidence (($verify -split "`n" | Select-String -Pattern 'WARNING|ERROR' | Select-Object -First 10) -join ' | ')

Write-Host ""
if ($script:Ran -eq 0) {
  Write-Host "FAIL: no control executed. Check the -Only filter." -ForegroundColor Red
  exit 1
}
if ($script:Failures.Count -gt 0) {
  Write-Host ("FAIL: {0}" -f ($script:Failures -join '; ')) -ForegroundColor Red
  exit 1
}
Write-Host ("OK: {0} tooling controls executed. Each verifier caught the condition it was written to catch, and the pre-login allowlist survived." `
  -f $script:Ran) -ForegroundColor Green
exit 0

