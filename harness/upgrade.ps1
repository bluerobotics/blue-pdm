# The upgrade lane.
#
# WHY THIS EXISTS
#
# Every release up to and including 92 was verified against a fresh install.
# That is one of the two ways the owner's database can arrive at a release, and
# it is not the one their database takes. Their database took the other one: it
# ran an earlier release, it was used, and then a new release was applied over
# the top.
#
# Nothing had ever asked whether a release cleans up after the holes it closes.
# It does not, and a fresh install cannot show that, because a fresh install has
# no history for the fix to fail to undo. Installing v90, running the attack
# suite so the database carried real damage, and then applying v92 in place left
# a cross-tenant share link that still answered is_valid: true to anon and still
# spent downloads - and verify_and_stamp_schema() returned stamped: true over
# it. One of seventeen attacks still succeeded on the upgrade lane while the
# fresh lane reported zero.
#
# So a release has to pass twice: once installed from nothing, and once applied
# over a damaged predecessor. This script is the second lane.
#
#   .\upgrade.ps1                                        # from ../../blueplm-v90/supabase
#   .\upgrade.ps1 -Baseline ../../blueplm-v91/supabase   # from somewhere else
#
# The baseline is mounted alongside the release under test rather than swapped
# in - see BASELINE_DIR in docker-compose.yml - so both halves exist at once and
# the run is reproducible by anybody with the two worktrees.
param(
  [string]$Baseline = '../../blueplm-v90/supabase',
  # The release applied over the baseline. Defaults to the working tree; point
  # it at another worktree to reproduce an older release's behaviour on this
  # lane, which is how the residue v92 leaves behind was measured.
  [string]$Release,
  # The attacks that must succeed against the baseline. A baseline that refuses
  # them is not carrying the damage this lane exists to create, so the run says
  # so and stops rather than reporting a clean upgrade over an undamaged
  # database.
  [switch]$AllowCleanBaseline
)

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

function Psql {
  param([string]$File, [string]$Sql)
  if ($File) {
    docker compose exec -T -e PGPASSWORD=postgres db `
      psql --no-psqlrc -U postgres -d postgres -h 127.0.0.1 -f $File 2>&1 | Out-String
  } else {
    docker compose exec -T -e PGPASSWORD=postgres db `
      psql --no-psqlrc -U postgres -d postgres -h 127.0.0.1 -c $Sql 2>&1 | Out-String
  }
}

function Get-StampedVersion {
  $v = docker compose exec -T -e PGPASSWORD=postgres db `
    psql -tAq --no-psqlrc -U postgres -d postgres -h 127.0.0.1 `
    -c "SELECT version FROM schema_version WHERE id = 1" 2>&1 | Out-String
  return $v.Trim()
}

$script:Failures = @()

# ---------------------------------------------------------------------------
# 1. Install the baseline and bring the API up against it.
# ---------------------------------------------------------------------------
Write-Host "=== UPGRADE LANE: installing the baseline ($Baseline) ===" -ForegroundColor Yellow
$env:BASELINE_DIR = $Baseline
if ($Release) { $env:RELEASE_DIR = $Release }
else          { Remove-Item Env:\RELEASE_DIR -ErrorAction SilentlyContinue }

# reset.ps1 and install.ps1 report failure by throwing rather than by exit code:
# psql writes NOTICEs to stderr, so $LASTEXITCODE after them belongs to whatever
# native command ran last and means nothing here.
try {
  & "$PSScriptRoot\reset.ps1" -Root /baseline
} catch {
  Write-Host ("ABORT: the baseline would not install: {0}" -f $_) -ForegroundColor Red
  exit 2
}

Write-Host "`n=== the baseline records itself as ===" -ForegroundColor Yellow
Psql -Sql "SELECT schema_release_version() AS release" | Write-Host

# ---------------------------------------------------------------------------
# 2. Attack it, for real. This is what puts damage in the database.
# ---------------------------------------------------------------------------
Write-Host "`n=== ATTACKING THE BASELINE (the damage the upgrade has to clean up) ===" -ForegroundColor Yellow
& powershell -NoProfile -File "$PSScriptRoot\attack.ps1" -Expect vulnerable
$baselineBreached = ($LASTEXITCODE -eq 0)
if (-not $baselineBreached) {
  if ($AllowCleanBaseline) {
    Write-Host "WARNING: the baseline did not reproduce every attack. Continuing because -AllowCleanBaseline was given." -ForegroundColor Yellow
  } else {
    Write-Host "ABORT: the baseline refused attacks it is supposed to allow, so the database is not damaged and an upgrade over it would prove nothing." -ForegroundColor Red
    exit 2
  }
}

# ---------------------------------------------------------------------------
# 3. What the attacks left behind, before the upgrade touches it.
# ---------------------------------------------------------------------------
Write-Host "`n=== RESIDUE LEFT BY THE ATTACKS, BEFORE THE UPGRADE ===" -ForegroundColor Yellow
$before = Psql -File '/sql/residue-report.sql'
Write-Host $before

# The lane is only meaningful if the attacks actually left something. If the
# report is empty here, the "after" report being empty says nothing at all.
if ($before -notmatch 'RESIDUE PRESENT') {
  Write-Host "ABORT: the attacks left no detectable residue, so this run cannot show that the upgrade removes any." -ForegroundColor Red
  exit 2
}

# ---------------------------------------------------------------------------
# 4. Apply the release under test IN PLACE. No teardown: this is the upgrade.
# ---------------------------------------------------------------------------
Write-Host "`n=== APPLYING THE RELEASE UNDER TEST OVER IT (no teardown) ===" -ForegroundColor Yellow
try {
  & "$PSScriptRoot\install.ps1" -Root /blueplm
} catch {
  Write-Host ("FAIL: the release would not apply over the baseline, which is the owner's upgrade path: {0}" -f $_) -ForegroundColor Red
  exit 2
}

# PostgREST has been running against the baseline this whole time and cached its
# schema at startup. An upgrade applied underneath it leaves the cache stale, so
# a function whose signature changed answers PGRST202 - which looks exactly like
# a missing function and has nothing to do with the release. Supabase issues the
# same NOTIFY from an event trigger after DDL; the harness sends it explicitly.
# Without this, the first upgrade-lane run reported consume_share_link missing
# while psql called it without complaint.
. "$PSScriptRoot\rest-ready.ps1"
Invoke-RestSchemaReload -ExpectRpc 'consume_share_link' | Out-Null

Write-Host "`n=== RESIDUE AFTER THE UPGRADE ===" -ForegroundColor Yellow
$after = Psql -File '/sql/residue-report.sql'
Write-Host $after
if ($after -match 'RESIDUE PRESENT') {
  Write-Host "FAIL: applying the release left residue from the holes it closes." -ForegroundColor Red
  $script:Failures += 'residue survived the upgrade'
}

Write-Host "`n=== WHAT THE REMEDIATION REPORTED ===" -ForegroundColor Yellow
Psql -Sql "SELECT remediation, release, rows_acted_on, left(detail, 90) AS detail FROM schema_remediation_log ORDER BY ran_at, remediation" | Write-Host

# ---------------------------------------------------------------------------
# 5. Verify, attack again, and run the posture checks - the same bar the fresh
#    lane has to clear, on a database with a history.
# ---------------------------------------------------------------------------
Write-Host "`n=== VERIFICATION AFTER THE UPGRADE ===" -ForegroundColor Yellow
$verify = Psql -File '/blueplm/tools/verify-schema.sql'
Write-Host (($verify -split "`n" | Select-String -Pattern 'NOTICE|WARNING|ERROR') -join "`n")
$target = (Psql -Sql "SELECT schema_release_version()") -split "`n" | Select-String -Pattern '^\s+\d+' | Select-Object -First 1
$stamped = Get-StampedVersion
Write-Host ("stamped version: {0}" -f $stamped)
if ($verify -match 'Schema verification failed') {
  Write-Host "FAIL: the upgraded database does not verify." -ForegroundColor Red
  $script:Failures += 'verification refused after the upgrade'
}

Write-Host "`n=== ATTACKS AFTER THE UPGRADE ===" -ForegroundColor Yellow
& powershell -NoProfile -File "$PSScriptRoot\attack.ps1" -Expect fixed
if ($LASTEXITCODE -ne 0) { $script:Failures += 'attacks still succeed after the upgrade' }

Write-Host "`n=== POSTURE CHECKS AFTER THE UPGRADE ===" -ForegroundColor Yellow
$posture = Psql -File '/sql/posture-checks.sql'
if ($posture -match 'POSTURE CHECKS PASSED') {
  $flat = ($posture -replace '\s+', ' ')
  [regex]::Matches($flat, 'PASS - [^.]+\.') | ForEach-Object { Write-Host ("  " + $_.Value) -ForegroundColor Green }
} else {
  Write-Host $posture -ForegroundColor Red
  $script:Failures += 'posture checks failed after the upgrade'
}

Remove-Item Env:\BASELINE_DIR -ErrorAction SilentlyContinue
Remove-Item Env:\RELEASE_DIR -ErrorAction SilentlyContinue

Write-Host ""
if ($script:Failures.Count -gt 0) {
  Write-Host ("FAIL (upgrade lane): {0}" -f ($script:Failures -join '; ')) -ForegroundColor Red
  exit 1
}
Write-Host "OK: the release applied over an attacked baseline, removed what the holes produced, verified, and refused every attack." -ForegroundColor Green
exit 0
