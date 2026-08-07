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
  [switch]$NoSeed,
  # Which mounted copy of supabase/ to install. /blueplm is the release under
  # test; /baseline is the one the upgrade lane starts from.
  [string]$Root = '/blueplm'
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
Write-Host ($log -split "`n" | Select-String -Pattern 'ASSERTIONS PASSED' | Out-String)

# Print the faithfulness evidence on every run. The demotion is the property a
# previous container silently lost, so it gets read out loud each time rather
# than being trusted to have happened.
#
# ASKED, NOT SCRAPED
#
# This used to grep the container log for lines beginning `db-1  | ` followed by
# a role name. docker compose pads that prefix to the width of the longest
# service name it is currently printing, and psql pads the role name column to
# the width of its widest value, so the pattern matched neither and
# evidence/00-harness-build.txt printed a column header with no rows under it -
# for every run, while the README said the demotion was read out loud each time.
# Nothing was wrong with the container; the evidence for it was simply absent.
#
# Querying the database directly cannot drift like that: there is no log format
# in between, and the numbers are the ones a check would use.
Write-Host "--- roles as this container actually has them ---"
docker compose exec -T -e PGPASSWORD=postgres db `
  psql --no-psqlrc -U postgres -d postgres -h 127.0.0.1 -c `
  "SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcanlogin
     FROM pg_roles
    WHERE rolname IN ('supabase_admin','postgres','authenticator','anon','authenticated','service_role')
    ORDER BY rolsuper DESC, rolname" 2>&1 | Write-Host

Write-Host "--- default privileges in public, which is what makes a new function anon-reachable ---"
docker compose exec -T -e PGPASSWORD=postgres db `
  psql --no-psqlrc -U postgres -d postgres -h 127.0.0.1 -c `
  "SELECT pg_get_userbyid(defaclrole) AS granting_role, defaclobjtype AS objtype, defaclacl
     FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
    WHERE n.nspname = 'public' ORDER BY 1, 2" 2>&1 | Write-Host

Write-Host "=== installing release ===" -ForegroundColor Yellow
if ($CoreOnly)      { & "$PSScriptRoot\install.ps1" -CoreOnly -Root $Root }
elseif ($Modules)   { & "$PSScriptRoot\install.ps1" -Modules $Modules -Root $Root }
else                { & "$PSScriptRoot\install.ps1" -Root $Root }
if ($LASTEXITCODE -ne 0) { throw "install failed" }

if (-not $NoSeed -and -not $CoreOnly) {
  Write-Host "=== seeding ===" -ForegroundColor Yellow
  $out = docker compose exec -T -e PGPASSWORD=postgres db `
    psql -v ON_ERROR_STOP=1 --no-psqlrc -U postgres -d postgres -h 127.0.0.1 -f /sql/seed.sql 2>&1
  if ($LASTEXITCODE -ne 0) { $out | Write-Host; throw "seed failed" }
}

Write-Host "=== starting PostgREST ===" -ForegroundColor Yellow
docker compose up -d rest 2>&1 | Out-Null

# Wait for it to answer, rather than sleeping a guessed ten seconds and then
# running `docker compose exec rest true` - which cannot work, because the
# PostgREST image has no shell and no /bin/true. It left $LASTEXITCODE at 126
# for every successful reset, so a caller that checked the exit code of this
# script concluded the harness had failed to build when it had not.
. "$PSScriptRoot\rest-ready.ps1"
Wait-RestReady | Out-Null

Write-Host "harness ready" -ForegroundColor Green
