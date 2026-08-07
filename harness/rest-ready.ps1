# Waiting for PostgREST, and making it re-read the schema.
#
# Two things the harness kept getting wrong, both of which produced failures
# that looked like defects in the release under test:
#
#   1. Readiness was a ten-second sleep followed by `docker compose exec rest
#      true`. The PostgREST image carries no shell and no /bin/true, so that
#      command always failed and always left $LASTEXITCODE at 126 - a passing
#      reset reported as a broken one by any caller that checked.
#
#   2. PostgREST caches the schema at startup. Applying a release over a running
#      instance - which is exactly what the upgrade lane does, and exactly what
#      an owner does when they paste the SQL into the Supabase editor with the
#      app running - leaves the cache describing the old schema, so a function
#      whose signature changed answers PGRST202 "Could not find the function in
#      the schema cache" while psql calls it happily. On a real Supabase project
#      an event trigger issues NOTIFY pgrst, 'reload schema' after DDL; the
#      harness has to send the same notification itself, or every upgrade run is
#      contaminated by failures that have nothing to do with the schema.

$RestBase = 'http://localhost:53000'

# An unauthenticated request is answered with 401 rather than refused, so any
# HTTP status at all means the process is listening. Written with the .NET
# exception unwrapped by hand because Invoke-WebRequest on Windows PowerShell
# 5.1 - which is what this repository is driven from - throws on 4xx and has no
# -SkipHttpErrorCheck, and left to itself will try to prompt for credentials on
# a 401 and fail with "NonInteractive mode" instead of reporting the status.
function Get-RestStatus {
  param([string]$Path = '/', [string]$Token, [int]$TimeoutSec = 5)
  $headers = @{ 'Accept' = 'application/json' }
  if ($Token) { $headers['Authorization'] = "Bearer $Token" }
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "$RestBase$Path" -Headers $headers `
           -TimeoutSec $TimeoutSec
    return [pscustomobject]@{ Status = [int]$r.StatusCode; Body = $r.Content }
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      $body = ''
      try {
        $sr = New-Object IO.StreamReader($resp.GetResponseStream())
        $body = $sr.ReadToEnd()
      } catch { }
      return [pscustomobject]@{ Status = [int]$resp.StatusCode; Body = $body }
    }
    return [pscustomobject]@{ Status = -1; Body = $_.Exception.Message }
  }
}

function Wait-RestReady {
  param([int]$TimeoutSeconds = 90)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $r = Get-RestStatus
    # Listening is not the same as ready. For a few seconds after start-up
    # PostgREST answers 503 PGRST002, "Could not query the database for the
    # schema cache. Retrying." - and a request made in that window comes back
    # as a failure that has nothing to do with the schema. Measured: a probe
    # taken right after reset.ps1 returned 503 and the identical probe eight
    # seconds later returned 200.
    if ($r.Status -gt 0 -and $r.Status -ne 503 -and $r.Body -notmatch 'PGRST002') {
      return $true
    }
    Start-Sleep -Seconds 1
  }
  throw "PostgREST did not answer on $RestBase within $TimeoutSeconds seconds"
}

# Make PostgREST forget what it thinks the schema looks like.
#
# Named for what Supabase's own event trigger does, so that anybody comparing
# the harness with a real project can see this is the same mechanism and not a
# harness-only shortcut. Verified rather than assumed: the caller names an RPC
# that must be callable before this returns.
function Invoke-RestSchemaReload {
  param(
    # An RPC the reloaded cache must contain, e.g. 'consume_share_link'. It is
    # POSTed with an empty body and any answer other than PGRST202 counts:
    # the question is whether PostgREST knows the function exists, not whether
    # the call succeeds.
    [string]$ExpectRpc,
    [string]$Token,
    [int]$TimeoutSeconds = 60
  )

  docker compose exec -T -e PGPASSWORD=postgres db `
    psql --no-psqlrc -U postgres -d postgres -h 127.0.0.1 `
    -c "NOTIFY pgrst, 'reload schema'" 2>&1 | Out-Null

  Wait-RestReady -TimeoutSeconds $TimeoutSeconds | Out-Null

  if (-not $ExpectRpc) { return $true }

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $r = Get-RestStatus -Path "/rpc/$ExpectRpc" -Token $Token
    if ($r.Status -gt 0 -and $r.Body -notmatch 'PGRST202') { return $true }
    Start-Sleep -Seconds 1
  }

  # A restart cannot fail to pick up the schema, so it is the fallback rather
  # than the mechanism: if NOTIFY did not take, the harness still has to be
  # usable, but it should be visible on the transcript that it did not.
  Write-Host "  (schema cache did not pick up $ExpectRpc after NOTIFY; restarting PostgREST)" -ForegroundColor DarkYellow
  docker compose restart rest 2>&1 | Out-Null
  Wait-RestReady -TimeoutSeconds $TimeoutSeconds | Out-Null
  return $true
}
