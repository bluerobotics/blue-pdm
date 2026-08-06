# Install the BluePLM release into the harness the way the owner does: as
# `postgres`, file by file, in the order supabase/README.md gives.
#
#   .\install.ps1                 core + every module
#   .\install.ps1 -CoreOnly       core.sql alone
#   .\install.ps1 -Modules 10,15  core plus a chosen subset
param(
  [switch]$CoreOnly,
  [string[]]$Modules = @('10-source-files','15-inspection','20-change-control',
                         '30-supply-chain','40-integrations','50-extensions','60-customers')
)

# psql writes NOTICEs to stderr, which PowerShell would otherwise turn into
# terminating errors before the exit code is ever consulted.
$ErrorActionPreference = 'Continue'

function Invoke-Psql {
  param([string]$File, [string]$AsRole = 'postgres')
  Write-Host "--- $AsRole : $File" -ForegroundColor Cyan
  $out = docker compose exec -T -e PGPASSWORD=postgres db `
    psql -v ON_ERROR_STOP=1 --no-psqlrc -U $AsRole -d postgres -h 127.0.0.1 -f $File 2>&1
  $code = $LASTEXITCODE
  $out | Select-String -Pattern 'ERROR|FATAL' | Select-Object -First 25 | ForEach-Object { Write-Host $_ -ForegroundColor Red }
  if ($code -ne 0) { throw "FAILED: $File (exit $code)" }
}

Invoke-Psql '/blueplm/core.sql'
if (-not $CoreOnly) {
  foreach ($m in $Modules) { Invoke-Psql "/blueplm/modules/$m.sql" }
}
Write-Host "install complete" -ForegroundColor Green
