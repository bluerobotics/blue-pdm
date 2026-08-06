# Tear the harness down to nothing and rebuild it: fresh volume, Supabase
# bootstrap, harness assertions, BluePLM release, seed, PostgREST.
#
# Before/after evidence is only worth something if the two runs differ in the
# SQL under test and in nothing else, so both runs go through this.
# docker compose and psql both write progress and NOTICEs to stderr, which
# 'Stop' would turn into terminating errors before any exit code is read.
# Failures are raised explicitly below instead.
param(
  [switch]$CoreOnly,
  [string[]]$Modules,
  [switch]$NoSeed
)

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

Write-Host "=== tearing down ===" -ForegroundColor Yellow
docker compose down -v --remove-orphans 2>&1 | Out-Null

Write-Host "=== starting database ===" -ForegroundColor Yellow
docker compose up -d db 2>&1 | Out-Null

# Wait for the init scripts, including 90-assert-harness.sql, to finish.
$deadline = (Get-Date).AddMinutes(4)
do {
  Start-Sleep -Seconds 3
  $health = (docker inspect --format '{{.State.Health.Status}}' blueplm-harness-db-1 2>$null)
  if ((Get-Date) -gt $deadline) { throw "database never became healthy" }
} while ($health -ne 'healthy')

# The assertions run as an init script; if any failed, initdb aborts and the
# container never reaches healthy. Surface the verdict either way.
$log = docker compose logs db 2>&1 | Out-String
if ($log -notmatch 'HARNESS ASSERTIONS PASSED') {
  Write-Host $log
  throw "harness assertions did not pass - the environment is not faithful, so nothing tested on it counts"
}
# Print the faithfulness evidence on every run. The demotion is the property a
# previous container silently lost, so it gets read out loud each time rather
# than being trusted to have happened.
Write-Host ($log -split "`n" |
  Select-String -Pattern 'ASSERTIONS PASSED|rolsuper|^db-1  \| (anon|authenticated|authenticator|postgres|service_role|supabase_admin) ' |
  Out-String)
Write-Host ($log -split "`n" | Select-String -Pattern 'defaclacl|=X/postgres|=X/supabase_admin' | Out-String)

Write-Host "=== installing release ===" -ForegroundColor Yellow
if ($CoreOnly)      { & "$PSScriptRoot\install.ps1" -CoreOnly }
elseif ($Modules)   { & "$PSScriptRoot\install.ps1" -Modules $Modules }
else                { & "$PSScriptRoot\install.ps1" }
if ($LASTEXITCODE -ne 0) { throw "install failed" }

if (-not $NoSeed -and -not $CoreOnly) {
  Write-Host "=== seeding ===" -ForegroundColor Yellow
  $out = docker compose exec -T -e PGPASSWORD=postgres db `
    psql -v ON_ERROR_STOP=1 --no-psqlrc -U postgres -d postgres -h 127.0.0.1 -f /sql/seed.sql 2>&1
  if ($LASTEXITCODE -ne 0) { $out | Write-Host; throw "seed failed" }
}

Write-Host "=== starting PostgREST ===" -ForegroundColor Yellow
docker compose up -d rest 2>&1 | Out-Null
Start-Sleep -Seconds 10
docker compose exec -T rest true 2>&1 | Out-Null

Write-Host "harness ready" -ForegroundColor Green
