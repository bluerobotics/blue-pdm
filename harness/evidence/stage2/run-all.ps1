# Stage 2 evidence capture.
#
# Every script in the harness reports through Write-Host, which writes to the
# host rather than to the success stream, so `.\x.ps1 | Tee-Object` captures an
# empty file while the operator watches the output scroll past. Running each one
# as a child process turns that host output back into stdout, which can be
# redirected. That is the whole reason this file exists.
$ErrorActionPreference = 'Continue'
$here = $PSScriptRoot                                    # ...\harness\evidence\stage2
$harness = Split-Path (Split-Path $here -Parent) -Parent # ...\harness
Set-Location $harness

$steps = @(
  @{ File = '1-reset.txt';              Script = 'reset.ps1';             Args = @() },
  @{ File = '2-tooling-controls.txt';   Script = 'tooling-controls.ps1';  Args = @() },
  @{ File = '3-negative-controls.txt';  Script = 'negative-controls.ps1'; Args = @() },
  @{ File = '4-attack-fixed.txt';       Script = 'attack.ps1';            Args = @('-Expect','fixed') },
  @{ File = '5-policy-controls.txt';    Script = 'policy-controls.ps1';   Args = @() },
  @{ File = '6-upgrade-81.txt';         Script = 'upgrade.ps1';           Args = @('-BaselineVersion','81') }
)

$summary = @()
foreach ($s in $steps) {
  $started = Get-Date
  Write-Host ("`n########## {0} {1} ##########" -f $s.Script, ($s.Args -join ' ')) -ForegroundColor Cyan
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $harness $s.Script) @($s.Args) 2>&1
  $code = $LASTEXITCODE
  $text = ($out | ForEach-Object { $_.ToString() }) -join "`r`n"
  Set-Content -Path (Join-Path $here $s.File) -Value $text -Encoding UTF8
  $elapsed = [int]((Get-Date) - $started).TotalSeconds
  Write-Host ("########## {0}: exit {1} after {2}s -> {3} ##########" -f $s.Script, $code, $elapsed, $s.File) -ForegroundColor Cyan
  $summary += [pscustomobject]@{ Script = $s.Script; Exit = $code; Seconds = $elapsed; File = $s.File }
}

Write-Host "`n=== STAGE 2 RUN SUMMARY ===" -ForegroundColor Yellow
$summary | Format-Table -AutoSize | Out-String | Write-Host
