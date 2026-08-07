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
# WHICH BASELINE, AND WHY IT IS A PARAMETER
#
# The first version of this lane hard-coded v90, and v90 was chosen because a
# worktree for it already existed. The owner's production database is on schema
# 85 and has been since 2026-07-31, so 90 -> 93 was the one upgrade that could
# not happen, and 85 -> 94 was the only one that could. The baseline is a
# parameter now, and it is a version number rather than a path, so asking for a
# different one is a two-character edit rather than a worktree someone has to
# know the convention for.
#
#   .\upgrade.ps1 -BaselineVersion 81      # from ../../blueplm-v81/supabase
#   .\upgrade.ps1                          # 90, the historical default
#   .\upgrade.ps1 -Baseline ../../somewhere-else/supabase
#
# THERE IS NO TREE AT 85. Checked with git log -S over src/lib/schemaVersion.ts
# and by reading the value out of every schema-touching commit: the file goes
# 81 -> 86 in one commit, 2f01b91, which folded versions 82 to 86 together.
# Production was upgraded from a working tree that was never committed. So 85
# cannot be installed, and the honest substitute is to bracket it: 81 is the
# newest committed tree strictly older than production, 86 the oldest committed
# tree containing everything production has. Every object an 85 database can
# hold is in at least one of them. Neither is production, and saying which is
# which matters more than picking one and calling it 85.
#
# The baseline is mounted alongside the release under test rather than swapped
# in - see BASELINE_DIR in docker-compose.yml - so both halves exist at once and
# the run is reproducible by anybody with the two worktrees.
param(
  # Resolved to ../../blueplm-v<N>/supabase, which is where the worktrees live:
  #   git worktree add ../../blueplm-v81 <commit> --detach
  [int]$BaselineVersion = 90,
  # An explicit path wins, for a baseline that is not laid out by convention.
  [string]$Baseline,
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

if (-not $Baseline) { $Baseline = "../../blueplm-v$BaselineVersion/supabase" }
if (-not (Test-Path (Join-Path $PSScriptRoot "$Baseline/core.sql"))) {
  Write-Host ("ABORT: no baseline at {0}. Create the worktree first:" -f $Baseline) -ForegroundColor Red
  Write-Host ("  git worktree add ../../blueplm-v{0} <commit> --detach" -f $BaselineVersion) -ForegroundColor Red
  exit 2
}

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

# What release the database believes it is, asked in a way that works on both
# sides of schema 89. schema_release_version() arrived in 89; before that the
# number lived only in schema_version, which core.sql and every module stamped
# unconditionally.
#
# Two queries rather than one CASE. Postgres resolves every function name in a
# statement when it parses it, not when it evaluates it, so a CASE whose
# untaken branch names schema_release_version() still fails outright on a
# database that does not have it - which is exactly the database this fallback
# exists for. The existence test has to be a separate statement.
function Get-ReleaseBelief {
  $has = (docker compose exec -T -e PGPASSWORD=postgres db `
    psql -tAq --no-psqlrc -U postgres -d postgres -h 127.0.0.1 -c `
    "SELECT to_regprocedure('schema_release_version()') IS NOT NULL" 2>$null | Out-String).Trim()

  if ($has -eq 't') {
    $v = docker compose exec -T -e PGPASSWORD=postgres db `
      psql -tAq --no-psqlrc -U postgres -d postgres -h 127.0.0.1 `
      -c "SELECT schema_release_version()" 2>$null | Out-String
  } else {
    $v = docker compose exec -T -e PGPASSWORD=postgres db `
      psql -tAq --no-psqlrc -U postgres -d postgres -h 127.0.0.1 `
      -c "SELECT version FROM schema_version WHERE id = 1" 2>$null | Out-String
  }
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

# What the baseline says it is, checked against what was asked for. A worktree
# pointed at the wrong commit produces a lane that runs perfectly and proves an
# upgrade nobody needed, which is worse than one that fails.
$baselineIs = Get-ReleaseBelief
Write-Host ("`n=== the baseline records itself as schema {0} ===" -f $baselineIs) -ForegroundColor Yellow
if ($baselineIs -ne "$BaselineVersion") {
  Write-Host ("ABORT: asked for baseline {0}, installed a database that records itself as {1}." -f $BaselineVersion, $baselineIs) -ForegroundColor Red
  Write-Host "The worktree is at the wrong commit. Nothing below would be measuring the upgrade you asked for." -ForegroundColor Red
  exit 2
}

# What still depends on uuid-ossp before anything is applied. The count is the
# point: migrate_uuid_defaults() was verified against the 93 a v90 database has,
# and an older baseline has a different number in tables no later release names.
Write-Host "`n=== uuid-ossp DEPENDENCY BEFORE THE UPGRADE ===" -ForegroundColor Yellow
Psql -File '/sql/uuid-default-census.sql' | Write-Host

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

# The dependency the release claims to remove, measured on the way out. Three
# things have to be true together and only the first is usually checked: no
# defaults left, the extension actually droppable, and a second run moving
# nothing. A missed default in a table this release never mentions keeps the
# extension pinned while the count reads zero.
Write-Host "`n=== uuid-ossp DEPENDENCY AFTER THE UPGRADE ===" -ForegroundColor Yellow
$uuidAfter = Psql -File '/sql/uuid-default-census.sql'
Write-Host $uuidAfter
if ($uuidAfter -match 'UUID-OSSP DROPPABLE: NO') {
  Write-Host "FAIL: something still depends on uuid-ossp after the upgrade." -ForegroundColor Red
  $script:Failures += 'uuid-ossp still pinned after the upgrade'
}
if ($uuidAfter -match 'SECOND RUN IS A NO-OP: NO') {
  Write-Host "FAIL: a second application of the release moves more defaults, so the first was incomplete." -ForegroundColor Red
  $script:Failures += 'migrate_uuid_defaults is not idempotent'
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
$target = Get-ReleaseBelief
$stamped = Get-StampedVersion
Write-Host ("release under test: {0}    stamped version: {1}" -f $target, $stamped)
if ($verify -match 'Schema verification failed') {
  Write-Host "FAIL: the upgraded database does not verify." -ForegroundColor Red
  $script:Failures += 'verification refused after the upgrade'
}
# A stamp that lags the release is the v90 defect: everything applied, and the
# number the app reads still says the database is behind.
if ($stamped -ne $target) {
  Write-Host ("FAIL: the release is {0} but the database is stamped {1}." -f $target, $stamped) -ForegroundColor Red
  $script:Failures += "stamped $stamped rather than $target"
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
  Write-Host ("FAIL (upgrade lane {0} -> {1}): {2}" -f $baselineIs, $target, ($script:Failures -join '; ')) -ForegroundColor Red
  exit 1
}
Write-Host ("OK (upgrade lane {0} -> {1}): the release applied over an attacked schema-{0} database, removed what the holes produced, moved every uuid-ossp default, verified, stamped {1}, and refused every attack." -f $baselineIs, $target) -ForegroundColor Green
exit 0
