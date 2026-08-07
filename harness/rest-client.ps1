# The HTTP and JWT half of the harness, in one place.
#
# attack.ps1 and policy-controls.ps1 both talk to PostgREST as real users with
# real HS256 tokens, and both have to agree about what a refusal looks like. Two
# copies of that would be two definitions, and the first time they drifted the
# two suites would be reporting on different products. Dot-sourced, in the same
# way reset.ps1 dot-sources rest-ready.ps1:
#
#   . "$PSScriptRoot\rest-client.ps1"
#   Initialize-RestClient -RestUrl $RestUrl -JwtSecret $JwtSecret

$script:RestUrl   = 'http://localhost:53000'
$script:JwtSecret = 'blueplm-harness-super-secret-jwt-token-with-at-least-32-characters'

# Requests that never reached the server. Recorded centrally rather than at each
# call site so that no call site can forget: a connection failure must never be
# scored as the server refusing.
$script:RestTransportFailures = @()

function Initialize-RestClient {
  param([string]$RestUrl, [string]$JwtSecret)
  if ($RestUrl)   { $script:RestUrl   = $RestUrl }
  if ($JwtSecret) { $script:JwtSecret = $JwtSecret }
  $script:RestTransportFailures = @()
}

function Get-RestTransportFailures { return $script:RestTransportFailures }

function ConvertTo-B64Url([byte[]]$Bytes) {
  [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}

function New-Jwt {
  param([string]$Sub, [string]$Role = 'authenticated', [string]$Email = '')
  $header  = '{"alg":"HS256","typ":"JWT"}'
  $exp     = [DateTimeOffset]::UtcNow.AddHours(2).ToUnixTimeSeconds()
  $claims  = @{ role = $Role; exp = $exp }

  # NO sub CLAIM AT ALL WHEN THERE IS NO SUBJECT
  #
  # This used to emit `"sub": ""` for the anon token. auth.uid() casts the claim
  # to uuid, `''::uuid` raises invalid_text_representation, and PostgREST turns
  # that into HTTP 400 - which the suite scored as a refusal. Every anon attack
  # that got as far as auth.uid() was therefore passing for the wrong reason,
  # inside the harness built to stop exactly that.
  #
  # A real Supabase publishable key carries no sub, so the claim is absent, the
  # GUC is absent, and auth.uid() is NULL. That is the case the gates are
  # written against and the one worth testing.
  if ($Sub)   { $claims.sub = $Sub; $claims.aud = 'authenticated' }
  if ($Email) { $claims.email = $Email }

  $payload = $claims | ConvertTo-Json -Compress
  $h = ConvertTo-B64Url ([Text.Encoding]::UTF8.GetBytes($header))
  $p = ConvertTo-B64Url ([Text.Encoding]::UTF8.GetBytes($payload))
  $signing = "$h.$p"
  $hmac = New-Object System.Security.Cryptography.HMACSHA256
  $hmac.Key = [Text.Encoding]::UTF8.GetBytes($script:JwtSecret)
  $sig = ConvertTo-B64Url ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($signing)))
  "$signing.$sig"
}

function Invoke-Rest {
  param(
    [string]$Path,
    [string]$Token,
    [string]$Method = 'GET',
    $Body = $null,
    # 'return=representation' makes PostgREST answer a write with the rows it
    # actually wrote. Without it an UPDATE that RLS matched to zero rows and one
    # that wrote three both answer 204, and the policy controls cannot tell a
    # refusal from a success.
    [string]$Prefer = ''
  )
  $headers = @{ Authorization = "Bearer $Token"; 'Accept' = 'application/json' }
  if ($Prefer) { $headers['Prefer'] = $Prefer }
  $uri = "$($script:RestUrl)$Path"
  try {
    if ($null -ne $Body) {
      $json = ($Body | ConvertTo-Json -Compress -Depth 6)
      $r = Invoke-WebRequest -UseBasicParsing -Uri $uri -Method $Method -Headers $headers `
             -ContentType 'application/json' -Body $json -TimeoutSec 20
    } else {
      $r = Invoke-WebRequest -UseBasicParsing -Uri $uri -Method $Method -Headers $headers -TimeoutSec 20
    }
    [pscustomobject]@{ Status = [int]$r.StatusCode; Body = $r.Content }
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      $sr = New-Object IO.StreamReader($resp.GetResponseStream())
      [pscustomobject]@{ Status = [int]$resp.StatusCode; Body = $sr.ReadToEnd() }
    } else {
      $script:RestTransportFailures += "$Method $Path"
      [pscustomobject]@{ Status = -1; Body = $_.Exception.Message }
    }
  }
}

function Trunc {
  param([string]$Text, [int]$Max = 220)
  if ($null -eq $Text) { return '' }
  $flat = ($Text -replace '\s+', ' ')
  if ($flat.Length -le $Max) { return $flat }
  $flat.Substring(0, $Max) + '...'
}
