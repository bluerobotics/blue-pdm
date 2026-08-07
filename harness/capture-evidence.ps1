# Regenerate everything in evidence/ from the committed scripts, in one go.
#
# WHY THIS EXISTS
#
# evidence/01-attacks-before-fix.txt could not be produced by the committed
# attack.ps1. Different label on one attack, no preflight section, no positive
# controls, a summary line missing the control count. The numbers in it were
# right and they reproduced - but the artefact was the output of an earlier,
# uncommitted script, which means nobody reading the repository could check it.
# Evidence that cannot be regenerated is testimony.
#
# So capture is a script rather than a habit, every file it writes carries a
# header naming the command that produced it, and the two halves of the
# before/after are two invocations of this one file.
#
#   .\capture-evidence.ps1 -Baseline ../../blueplm-v90/supabase   # the "before"
#   .\capture-evidence.ps1                                        # the "after"
#   .\capture-evidence.ps1 -Upgrade                               # the upgrade lane
#
# -Baseline points RELEASE_DIR at another checkout of supabase/ (see the README)
# and writes only the two "before" files, because the negative controls and the
# posture checks are about the release under test and have nothing to say about
# an older one.
#
# -Upgrade captures the second lane: the previous release installed, attacked,
# and then upgraded to the release under test in place. It is a separate
# invocation rather than a step of the "after" run because it destroys the
# database it starts from and leaves behind one that has a history, which is the
# opposite of what every other file in evidence/ is captured against.
param(
  [string]$Baseline,
  [switch]$Upgrade,
  [string]$UpgradeFrom = '../../blueplm-v90/supabase'
)

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

$evidence = Join-Path $PSScriptRoot 'evidence'
New-Item -ItemType Directory -Force -Path $evidence | Out-Null

# psql's output goes through two lossy hops on the way to a file here: the
# container's stdout into PowerShell, and PowerShell's pipeline into Set-Content.
# The check marks in verify-schema.sql came out as mojibake through the first and
# as question marks once the console encoding was forced, which is the usual
# Windows outcome and not something a captured artefact should depend on. So the
# psql runs write their output inside the container and it is copied out as
# bytes, and what lands in evidence/ is exactly what psql wrote.
function Invoke-PsqlToFile {
  param([string]$Script)
  docker compose exec -T -e PGPASSWORD=postgres -e PGCLIENTENCODING=UTF8 db `
    bash -c "psql --no-psqlrc -U postgres -d postgres -h 127.0.0.1 -f $Script > /tmp/capture.txt 2>&1" | Out-Null
  $tmp = Join-Path $env:TEMP ("blueplm-capture-{0}.txt" -f [guid]::NewGuid())
  docker compose cp db:/tmp/capture.txt $tmp 2>&1 | Out-Null
  $lines = [IO.File]::ReadAllText($tmp, [Text.Encoding]::UTF8) -split "`r?`n"
  Remove-Item $tmp -ErrorAction SilentlyContinue
  return $lines
}

function Save {
  param([string]$Name, [string]$Command, [string[]]$Lines)
  $path = Join-Path $evidence $Name
  $header = @(
    "# $Name",
    "# Produced by: $Command",
    "# Release under test: $(if ($Baseline) { $Baseline } elseif ($Upgrade) { "the working tree, applied over $UpgradeFrom" } else { 'the working tree' })",
    "# Captured: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K') by capture-evidence.ps1",
    "#",
    "# Unedited output. Re-run the command above to reproduce it.",
    ''
  )
  Set-Content -Path $path -Value ($header + $Lines) -Encoding utf8
  Write-Host ("wrote {0} ({1} lines)" -f $Name, $Lines.Count) -ForegroundColor Green
}

# Colour escapes would land in the files and make them unreadable in a diff, and
# psql speaks UTF-8 whatever the console's code page says - without this the
# check marks in a captured verification run come out as mojibake.
$env:NO_COLOR = '1'
$env:PGCLIENTENCODING = 'UTF8'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
if ($Baseline) { $env:RELEASE_DIR = $Baseline } else { Remove-Item Env:\RELEASE_DIR -ErrorAction SilentlyContinue }

if ($Upgrade) {
  $lane = & powershell -NoProfile -File "$PSScriptRoot\upgrade.ps1" -Baseline $UpgradeFrom 2>&1 | ForEach-Object { "$_" }
  Save -Name '07-upgrade-lane.txt' -Command (".\upgrade.ps1 -Baseline {0}" -f $UpgradeFrom) -Lines $lane
  Write-Host "`nUpgrade lane captured." -ForegroundColor Green
  exit 0
}

$build = & powershell -NoProfile -File "$PSScriptRoot\reset.ps1" 2>&1 | ForEach-Object { "$_" }

# 00 describes the build of the release under test, so a baseline run leaves it
# alone rather than replacing it with a v90 build log - which is how you end up
# with an evidence directory whose files do not describe the same thing.
if (-not $Baseline) { Save -Name '00-harness-build.txt' -Command '.\reset.ps1' -Lines $build }

if ($Baseline) {
  $attacks = & powershell -NoProfile -File "$PSScriptRoot\attack.ps1" -Expect vulnerable 2>&1 | ForEach-Object { "$_" }
  Save -Name '01-attacks-before-fix.txt' -Command '.\attack.ps1 -Expect vulnerable' -Lines $attacks

  Save -Name '02-verify-before-fix.txt' -Command 'psql -f /blueplm/tools/verify-schema.sql' `
    -Lines (Invoke-PsqlToFile '/blueplm/tools/verify-schema.sql')

  Remove-Item Env:\RELEASE_DIR -ErrorAction SilentlyContinue
  Write-Host "`nBaseline captured. Run this again with no arguments for the other half." -ForegroundColor Yellow
  exit 0
}

$attacks = & powershell -NoProfile -File "$PSScriptRoot\attack.ps1" -Expect fixed 2>&1 | ForEach-Object { "$_" }
Save -Name '03-attacks-after-fix.txt' -Command '.\attack.ps1 -Expect fixed' -Lines $attacks

Save -Name '04-verify-after-fix.txt' -Command 'psql -f /blueplm/tools/verify-schema.sql' `
  -Lines (Invoke-PsqlToFile '/blueplm/tools/verify-schema.sql')

$controls = & powershell -NoProfile -File "$PSScriptRoot\negative-controls.ps1" 2>&1 | ForEach-Object { "$_" }
Save -Name '05-negative-controls.txt' -Command '.\negative-controls.ps1' -Lines $controls

$tooling = & powershell -NoProfile -File "$PSScriptRoot\tooling-controls.ps1" 2>&1 | ForEach-Object { "$_" }
Save -Name '08-tooling-controls.txt' -Command '.\tooling-controls.ps1' -Lines $tooling

# The only executed evidence that schema 95's five policy fixes exist, because
# schema_release_manifest() has no 'policy' kind and check_schema_release()
# therefore cannot see any of them. Captured after the negative controls, and
# before the reopen below, because it reverts and restores real policies and
# must not be running while anything else is reading them.
$policies = & powershell -NoProfile -File "$PSScriptRoot\policy-controls.ps1" 2>&1 | ForEach-Object { "$_" }
Save -Name '09-policy-controls.txt' -Command '.\policy-controls.ps1' -Lines $policies

# The lockdown script is the answer for a running database that cannot wait for
# a schema upgrade, so it is captured against a database that has just been put
# back into the open state - otherwise the run proves only that it is a no-op on
# a database already closed.
#
# THAT SENTENCE USED TO BE FALSE
#
# It was here, in these words, over a capture that did no such thing. Nothing
# between the reset and this line reopened anything, so the lockdown ran against
# a database the release had already closed and evidence/06-lockdown.txt
# recorded "Revoked EXECUTE from anon on 0 function(s)" as the proof that the
# lockdown works. sql/reopen-for-lockdown.sql is the missing step; the capture
# below now shows the script revoking something.
#
# The reopen runs last in this file, after the controls, because it deliberately
# leaves the database open until the lockdown closes it again.
Invoke-PsqlToFile '/sql/reopen-for-lockdown.sql' | Out-Null

Save -Name '06-lockdown.txt' -Command 'psql -f /sql/reopen-for-lockdown.sql ; psql -f /blueplm/tools/emergency-lockdown.sql' `
  -Lines (Invoke-PsqlToFile '/blueplm/tools/emergency-lockdown.sql')

Write-Host "`nAll evidence regenerated." -ForegroundColor Green
