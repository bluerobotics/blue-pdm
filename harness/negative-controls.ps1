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
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

$RELEASE = 91

function Psql {
  param([string]$Sql, [string]$File)
  if ($File) {
    docker compose exec -T -e PGPASSWORD=postgres db `
      psql -v ON_ERROR_STOP=1 --no-psqlrc -U postgres -d postgres -h 127.0.0.1 -f $File 2>&1 | Out-String
  } else {
    docker compose exec -T -e PGPASSWORD=postgres db `
      psql -v ON_ERROR_STOP=1 --no-psqlrc -U postgres -d postgres -h 127.0.0.1 -c $Sql 2>&1 | Out-String
  }
}

function Get-StampedVersion {
  $v = docker compose exec -T -e PGPASSWORD=postgres db `
    psql -tAq --no-psqlrc -U postgres -d postgres -h 127.0.0.1 `
    -c "SELECT version FROM schema_version WHERE id = 1" 2>&1 | Out-String
  return ([int]($v.Trim()))
}

function Invoke-Verify {
  docker compose exec -T -e PGPASSWORD=postgres db `
    psql --no-psqlrc -U postgres -d postgres -h 127.0.0.1 -f /blueplm/tools/verify-schema.sql 2>&1 | Out-String
}

$script:Failures = @()

function Test-Control {
  param(
    [string]$Id,
    [string]$What,
    [string]$HoleFile,      # SQL that reintroduces the hole
    [string]$ExpectToken,   # must appear in the refusal, so the right check caught it
    [string[]]$RepairFiles  # module files that put it back
  )
  Write-Host "`n--- $Id  $What" -ForegroundColor Cyan

  # Start from a known stamped state so "did not advance" is unambiguous.
  Psql -Sql "UPDATE schema_version SET version = 0 WHERE id = 1" | Out-Null

  $applied = Psql -File $HoleFile
  if ($applied -match 'ERROR') {
    Write-Host "  hole did not apply:" -ForegroundColor Red
    Write-Host $applied
    $script:Failures += "$Id (hole failed to apply)"
    return
  }

  $out = Invoke-Verify
  $version = Get-StampedVersion
  $refused = ($out -match 'Schema verification failed')
  $named   = ($out -match [regex]::Escape($ExpectToken))

  if ($refused -and $named -and $version -eq 0) {
    Write-Host "  caught: stamp withheld, version still 0, reason mentions '$ExpectToken'" -ForegroundColor Green
  } else {
    Write-Host ("  NOT CAUGHT: refused={0} named='{1}'={2} version={3}" -f $refused, $ExpectToken, $named, $version) -ForegroundColor Red
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
}

Write-Host "=== NEGATIVE CONTROLS ===" -ForegroundColor Yellow

# Sanity: we must start from a database that verification accepts. Otherwise
# every control below "fails verification" for free.
Invoke-Verify | Out-Null
if ((Get-StampedVersion) -ne $RELEASE) {
  Write-Host "ABORT: the database does not verify clean before the controls start." -ForegroundColor Red
  Invoke-Verify | Select-String -Pattern 'WARNING|ERROR' | Select-Object -First 20
  exit 2
}
Write-Host "baseline verifies clean at $RELEASE" -ForegroundColor Green

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

Write-Host ""
if ($script:Failures.Count -gt 0) {
  Write-Host ("FAIL: {0}" -f ($script:Failures -join '; ')) -ForegroundColor Red
  exit 1
}
Write-Host "OK: every hole was caught by the verifier, and removing it restored the stamp." -ForegroundColor Green
exit 0
