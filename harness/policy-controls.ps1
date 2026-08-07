# Negative controls for schema 95's policy fixes: A1a, A1b, A3, A4, A5, A6, A7,
# and the storage.objects coverage that A2 is blocked on.
#
# WHY THIS FILE HAD TO EXIST
#
# schema_release_manifest() has kinds 'table' and 'function' and no 'policy'.
# Five of schema 95's seven fixes are row-level security policies, so
# check_schema_release() cannot see any of them: a database whose users
# self-update policy has silently lost its WITH CHECK verifies clean and stamps.
# The manifest is not the safety net for this release. This file is.
#
# WHAT A CONTROL HERE MEANS
#
# Each fix is run twice. First against the release as it stands: every assertion
# Agent A published must hold. Then with that one fix reverted to its schema-94
# text - taken verbatim from `git show HEAD:` - and the same assertions run
# again, where the ones that were closing a hole must now report the hole open.
#
# The second half is the whole point. An assertion that refuses both before and
# after the fix is not evidence of the fix; it is evidence of something else in
# the schema, and three releases in a row shipped verification that could not
# tell the difference. An assertion listed as MustFlip and found not to flip is
# reported as a defective control, not as a pass.
#
# The real policy is restored from a snapshot of the live definition rather than
# from a copy kept here - see sql/policy-snapshot.sql for why that matters.
#
# PREREQUISITES
#
#   .\reset.ps1     # a freshly installed release, seeded, with PostgREST up
#
# Fixtures are re-applied before every phase, which is also what undoes the
# damage a reverted policy lets through: an A1a escalation really does move a
# viewer into another organization as its administrator, and the next
# application of sql/policy-fixtures.sql really does put them back.
param(
  [string]$RestUrl   = 'http://localhost:53000',
  [string]$JwtSecret = 'blueplm-harness-super-secret-jwt-token-with-at-least-32-characters',
  # Fix ids to run. Empty means all of them.
  [string[]]$Only = @(),
  # Assertions only, no revert phase. Faster, and proves nothing on its own -
  # which is why it is not the default.
  [switch]$NoReverts
)

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

. "$PSScriptRoot\rest-client.ps1"
Initialize-RestClient -RestUrl $RestUrl -JwtSecret $JwtSecret

# ---------------------------------------------------------------- identities --
$ACME_ORG = 'aaaaaaaa-0000-4000-8000-000000000001'
$UMB_ORG  = 'bbbbbbbb-0000-4000-8000-000000000001'
$ALICE    = 'aaaaaaaa-1111-4000-8000-000000000001'
$UMB_FILE = 'bbbbbbbb-3333-4000-8000-000000000001'

$VIEWER   = 'eeeeeeee-1111-4000-8000-000000000001'
$ENGINEER = 'eeeeeeee-1111-4000-8000-000000000002'
$MEMBER   = 'eeeeeeee-1111-4000-8000-000000000003'
$REVIEWER = 'eeeeeeee-1111-4000-8000-000000000004'
$EDITOR   = 'eeeeeeee-1111-4000-8000-000000000005'
$DELETER  = 'eeeeeeee-1111-4000-8000-000000000006'

$F_TRASH   = 'eeeeeeee-3333-4000-8000-000000000001'
$F_LIVE    = 'eeeeeeee-3333-4000-8000-000000000002'
$F_TRASHED = 'eeeeeeee-3333-4000-8000-000000000003'
$F_LINK    = 'eeeeeeee-3333-4000-8000-000000000004'

$LINK_OWN = 'pc0000000000000000000000000a4own'
$LINK_OFF = 'pc0000000000000000000000000a4off'
$LINK_REV = 'pc0000000000000000000000000a4rev'

function Review([string]$Suffix) { return "eeeeeeee-aaaa-4000-8000-0000000000$Suffix" }

$TOK_ANON     = New-Jwt -Sub '' -Role 'anon'
$TOK_ALICE    = New-Jwt -Sub $ALICE    -Email 'alice@acme.test'
$TOK_VIEWER   = New-Jwt -Sub $VIEWER   -Email 'viewer@acme.test'
$TOK_ENGINEER = New-Jwt -Sub $ENGINEER -Email 'engineer@acme.test'
$TOK_MEMBER   = New-Jwt -Sub $MEMBER   -Email 'member@acme.test'
$TOK_REVIEWER = New-Jwt -Sub $REVIEWER -Email 'reviewer@acme.test'
$TOK_EDITOR   = New-Jwt -Sub $EDITOR   -Email 'editor@acme.test'
$TOK_DELETER  = New-Jwt -Sub $DELETER  -Email 'deleter@acme.test'

# --------------------------------------------------------------------- psql --
# stderr merged inside the container rather than in PowerShell, for the reason
# spelled out at the top of tooling-controls.ps1: psql writes NOTICEs to stderr
# and PowerShell renders each one as a hard-wrapped ErrorRecord, which breaks
# -match on any identifier long enough to matter.
function Invoke-PsqlFile {
  param([string]$File, [switch]$StopOnError)
  $stop = if ($StopOnError) { '-v ON_ERROR_STOP=1 ' } else { '' }
  $command = "psql $stop--no-psqlrc -U postgres -d postgres -h 127.0.0.1 -f '$File' 2>&1"
  return (docker compose exec -T -e PGPASSWORD=postgres -e PGCLIENTENCODING=UTF8 db `
            bash -c $command | Out-String)
}

# SQL GOES IN ON STDIN, NOT IN -c
#
# The obvious form - bash -c "psql ... -c `"$Sql`"" - does not survive the trip.
# PowerShell re-quotes each argument on its way to a native command and does not
# escape double quotes inside one, so the argument splits at the first `"` and
# psql is handed a fragment. It fails silently: the caller gets an empty string,
# which Get-Scalar's callers read as "the object is not there". Every catalogue
# question in this file would have answered false, and the suite would have
# reported a clean database as broken - or, worse, a broken one as clean.
#
# psql with no -c and no -f reads its script from stdin, and the bash string
# then contains no quotes at all, so there is nothing to mangle.
function Invoke-PsqlStdin {
  param([string]$Sql, [string]$Redirect = '2>&1', [string]$Flags = '')
  return (($Sql | docker compose exec -T -e PGPASSWORD=postgres -e PGCLIENTENCODING=UTF8 db `
             bash -c "psql $Flags-tAq --no-psqlrc -U postgres -d postgres -h 127.0.0.1 $Redirect" `
           | Out-String).Trim())
}

function Get-Scalar {
  param([string]$Sql)
  return (Invoke-PsqlStdin -Sql $Sql -Redirect '2>/dev/null')
}

function Invoke-Sql {
  param([string]$Sql)
  return (Invoke-PsqlStdin -Sql $Sql -Flags '-v ON_ERROR_STOP=1 ')
}

# Re-applied before every phase. Authoritative, not additive: see the header of
# sql/policy-fixtures.sql.
function Reset-Fixtures {
  $out = Invoke-PsqlFile -File '/sql/policy-fixtures.sql' -StopOnError
  if ($out -cmatch 'ERROR:') {
    Write-Host "ABORT: the fixtures did not apply, so nothing below would be measuring anything." -ForegroundColor Red
    Write-Host $out
    exit 2
  }
}

# ------------------------------------------------------------------ scoring --
$script:Rows        = @()
$script:Failures    = @()
$script:Phase       = 'fixed'
$script:Ran         = 0
# Per fix: which of its declared Flips actually flipped when it was reverted.
# Written once in phase 2 and read by the summary, so the run cannot print two
# different answers to the same question.
$script:FlipResults = @{}

# A write, scored from what PostgREST actually returned.
#
# `Prefer: return=representation` is what makes this decidable. Without it an
# UPDATE that RLS matched to zero rows and one that wrote three both answer 204
# and the two are indistinguishable - which is the same class of mistake as
# scoring PGRST202 as a refusal, one layer up.
#
#   4xx/5xx    - refused, and the body carries the SQLSTATE. A WITH CHECK
#                violation is 42501 and arrives this way.
#   200 + []   - refused. The USING clause matched no row, which PostgREST
#                reports as a successful update of nothing.
#   200 + rows - succeeded.
function Get-WriteOutcome {
  param($Response)
  if ($Response.Status -eq -1)   { return 'transport' }
  if ($Response.Status -ge 400)  { return 'refused' }
  $body = ('' + $Response.Body).Trim()
  if ($body -eq '' -or $body -eq '[]') { return 'refused' }
  return 'succeeded'
}

function Add-Row {
  param([string]$Fix, [string]$Id, [string]$What, [string]$Want, [string]$Got, [string]$Evidence)
  $ok = ($Want -eq $Got)
  $script:Rows += [pscustomobject]@{
    Fix = $Fix; Id = $Id; What = $What; Want = $Want; Got = $Got
    Evidence = $Evidence; Phase = $script:Phase; Ok = $ok
  }
  if ($script:Phase -eq 'fixed') {
    $verdict = if ($ok) { 'ok      ' } else { 'MISMATCH' }
    $colour  = if ($ok) { 'Green' } else { 'Red' }
    Write-Host ("  [{0}] {1}  {2}" -f $verdict, $Id.PadRight(5), $What) -ForegroundColor $colour
    if (-not $ok) {
      Write-Host ("            wanted '{0}', got '{1}'" -f $Want, $Got) -ForegroundColor Red
      Write-Host ("            {0}" -f $Evidence) -ForegroundColor DarkGray
    }
  }
}

function Assert-Write {
  param([string]$Fix, [string]$Id, [string]$What, [string]$Want, $Response)
  Add-Row -Fix $Fix -Id $Id -What $What -Want $Want -Got (Get-WriteOutcome $Response) `
          -Evidence ("HTTP {0}: {1}" -f $Response.Status, (Trunc $Response.Body 260))
}

# complete_gate_review() answers 200 with a JSON object either way, so the
# verdict is the error_code and not the status. 'success' when it got past every
# authorization term.
function Assert-Rpc {
  param([string]$Fix, [string]$Id, [string]$What, [string]$Want, $Response)
  $body = '' + $Response.Body
  $got  = 'success'
  if ($Response.Status -eq -1)      { $got = 'transport' }
  elseif ($Response.Status -ge 400) { $got = 'http-' + $Response.Status }
  elseif ($body -match '"error_code"\s*:\s*"([A-Z_]+)"') { $got = $Matches[1] }
  elseif ($body -notmatch '"success"\s*:\s*true')        { $got = 'no-success-flag' }
  Add-Row -Fix $Fix -Id $Id -What $What -Want $Want -Got $got `
          -Evidence ("HTTP {0}: {1}" -f $Response.Status, (Trunc $body 260))
}

# For a check that is not an HTTP write - a catalogue fact, a count.
function Assert-Fact {
  param([string]$Fix, [string]$Id, [string]$What, [string]$Want, [string]$Got, [string]$Evidence)
  Add-Row -Fix $Fix -Id $Id -What $What -Want $Want -Got $Got -Evidence $Evidence
}

function New-LinkToken {
  # Prefixed pc0 so sql/policy-fixtures.sql sweeps it up, 32 characters to match
  # the shape create_file_share_link() mints.
  return ('pc0' + ([guid]::NewGuid().ToString('N')).Substring(0, 29))
}

# ------------------------------------------------------------- the fix table --
# Assertions from A_AGENT_REPORT.md section 1, numbered as Agent A numbered them
# so the two documents can be read side by side.
#
# Flips is the heart of it: the assertion ids that must report the hole OPEN
# once the fix is reverted. An id in this list that does not flip means the
# assertion is passing for some reason other than the fix, and is reported as a
# defective control rather than as a pass.
#
# NotFlipping records, per fix, the assertions deliberately excluded from Flips
# and why - so that a short list is a considered one rather than an oversight.

function Invoke-A1a {
  Assert-Write -Fix 'A1a' -Id '1' -What 'viewer moves themselves into another organization' -Want 'refused' `
    -Response (Invoke-Rest -Path "/users?id=eq.$VIEWER" -Token $TOK_VIEWER -Method PATCH `
                 -Prefer 'return=representation' -Body @{ org_id = $UMB_ORG })

  Assert-Write -Fix 'A1a' -Id '2' -What 'viewer makes themselves an administrator' -Want 'refused' `
    -Response (Invoke-Rest -Path "/users?id=eq.$VIEWER" -Token $TOK_VIEWER -Method PATCH `
                 -Prefer 'return=representation' -Body @{ role = 'admin' })

  Assert-Write -Fix 'A1a' -Id '3' -What 'viewer becomes administrator OF another organization (the findings reproduction)' -Want 'refused' `
    -Response (Invoke-Rest -Path "/users?id=eq.$VIEWER" -Token $TOK_VIEWER -Method PATCH `
                 -Prefer 'return=representation' -Body @{ org_id = $UMB_ORG; role = 'admin' })

  # A's regression control. If this fails the check is too wide and every
  # sign-in in the product writes last_online.
  Assert-Write -Fix 'A1a' -Id '4' -What 'viewer still writes their own last_online (regression control)' -Want 'succeeded' `
    -Response (Invoke-Rest -Path "/users?id=eq.$VIEWER" -Token $TOK_VIEWER -Method PATCH `
                 -Prefer 'return=representation' -Body @{ last_online = (Get-Date).ToUniversalTime().ToString('o') })

  Assert-Write -Fix 'A1a' -Id '5' -What 'anon patches a user row at all (proves TO authenticated)' -Want 'refused' `
    -Response (Invoke-Rest -Path "/users?id=eq.$VIEWER" -Token $TOK_ANON -Method PATCH `
                 -Prefer 'return=representation' -Body @{ role = 'admin' })
}

function Invoke-A1b {
  Assert-Write -Fix 'A1b' -Id '6' -What "admin still changes a member's role (updateUserRole, teams.ts:37 - the control that stops a future agent 'fixing' A1b)" -Want 'succeeded' `
    -Response (Invoke-Rest -Path "/users?id=eq.$VIEWER" -Token $TOK_ALICE -Method PATCH `
                 -Prefer 'return=representation' -Body @{ role = 'engineer' })

  Assert-Write -Fix 'A1b' -Id '7' -What 'admin moves a member to a foreign organization' -Want 'refused' `
    -Response (Invoke-Rest -Path "/users?id=eq.$VIEWER" -Token $TOK_ALICE -Method PATCH `
                 -Prefer 'return=representation' -Body @{ org_id = $UMB_ORG })

  Assert-Write -Fix 'A1b' -Id '8' -What 'admin moves THEMSELVES to a foreign organization' -Want 'refused' `
    -Response (Invoke-Rest -Path "/users?id=eq.$ALICE" -Token $TOK_ALICE -Method PATCH `
                 -Prefer 'return=representation' -Body @{ org_id = $UMB_ORG })
}

function Invoke-A3 {
  Assert-Write -Fix 'A3' -Id '9' -What "engineer files a link under Acme pointing at UMBRELLA's file (the E1 attack)" -Want 'refused' `
    -Response (Invoke-Rest -Path '/file_share_links' -Token $TOK_ENGINEER -Method POST `
                 -Prefer 'return=representation' -Body @{
                   org_id = $ACME_ORG; file_id = $UMB_FILE; token = (New-LinkToken)
                   created_by = $ENGINEER; max_downloads = 5; require_auth = $false; is_active = $true })

  Assert-Write -Fix 'A3' -Id '10' -What 'engineer forges created_by as somebody else' -Want 'refused' `
    -Response (Invoke-Rest -Path '/file_share_links' -Token $TOK_ENGINEER -Method POST `
                 -Prefer 'return=representation' -Body @{
                   org_id = $ACME_ORG; file_id = $F_LINK; token = (New-LinkToken)
                   created_by = $VIEWER; max_downloads = 5; require_auth = $false; is_active = $true })

  Assert-Write -Fix 'A3' -Id '11' -What 'viewer without module:explorer:create mints a link (pre-existing term, must stay)' -Want 'refused' `
    -Response (Invoke-Rest -Path '/file_share_links' -Token $TOK_VIEWER -Method POST `
                 -Prefer 'return=representation' -Body @{
                   org_id = $ACME_ORG; file_id = $F_LINK; token = (New-LinkToken)
                   created_by = $VIEWER; max_downloads = 5; require_auth = $false; is_active = $true })

  Assert-Write -Fix 'A3' -Id '12' -What 'engineer still mints a legitimate link for their own file (regression control)' -Want 'succeeded' `
    -Response (Invoke-Rest -Path '/file_share_links' -Token $TOK_ENGINEER -Method POST `
                 -Prefer 'return=representation' -Body @{
                   org_id = $ACME_ORG; file_id = $F_LINK; token = (New-LinkToken)
                   created_by = $ENGINEER; max_downloads = 5; require_auth = $false; is_active = $true })
}

function Invoke-A4 {
  Assert-Write -Fix 'A4' -Id '13' -What "viewer repoints their own link at UMBRELLA's file (the E2 attack)" -Want 'refused' `
    -Response (Invoke-Rest -Path "/file_share_links?token=eq.$LINK_OWN" -Token $TOK_VIEWER -Method PATCH `
                 -Prefer 'return=representation' -Body @{ file_id = $UMB_FILE })

  Assert-Write -Fix 'A4' -Id '14' -What 'viewer re-activates a link that had been revoked (the E4 attack)' -Want 'refused' `
    -Response (Invoke-Rest -Path "/file_share_links?token=eq.$LINK_OFF" -Token $TOK_VIEWER -Method PATCH `
                 -Prefer 'return=representation' -Body @{ is_active = $true })

  Assert-Write -Fix 'A4' -Id '15' -What 'viewer rewrites org_id on their own link' -Want 'refused' `
    -Response (Invoke-Rest -Path "/file_share_links?token=eq.$LINK_OWN" -Token $TOK_VIEWER -Method PATCH `
                 -Prefer 'return=representation' -Body @{ org_id = $UMB_ORG })

  Assert-Write -Fix 'A4' -Id '16' -What 'viewer still revokes their own link - the one update admitted (regression control)' -Want 'succeeded' `
    -Response (Invoke-Rest -Path "/file_share_links?token=eq.$LINK_REV" -Token $TOK_VIEWER -Method PATCH `
                 -Prefer 'return=representation' -Body @{ is_active = $false })

  Assert-Write -Fix 'A4' -Id '17' -What "engineer revokes somebody else's link" -Want 'refused' `
    -Response (Invoke-Rest -Path "/file_share_links?token=eq.$LINK_OWN" -Token $TOK_ENGINEER -Method PATCH `
                 -Prefer 'return=representation' -Body @{ is_active = $false })
}

function Invoke-A5 {
  Assert-Write -Fix 'A5' -Id '18' -What 'member without module:reviews:edit approves a review' -Want 'refused' `
    -Response (Invoke-Rest -Path ("/pending_reviews?id=eq." + (Review '18')) -Token $TOK_MEMBER -Method PATCH `
                 -Prefer 'return=representation' -Body @{ status = 'approved'; reviewed_by = $MEMBER })

  Assert-Write -Fix 'A5' -Id '19' -What 'reviewer approves but records SOMEBODY ELSE as the reviewer' -Want 'refused' `
    -Response (Invoke-Rest -Path ("/pending_reviews?id=eq." + (Review '19')) -Token $TOK_REVIEWER -Method PATCH `
                 -Prefer 'return=representation' -Body @{ status = 'approved'; reviewed_by = $MEMBER })

  Assert-Write -Fix 'A5' -Id '20' -What 'reviewer approves and records themselves (regression control)' -Want 'succeeded' `
    -Response (Invoke-Rest -Path ("/pending_reviews?id=eq." + (Review '20')) -Token $TOK_REVIEWER -Method PATCH `
                 -Prefer 'return=representation' -Body @{ status = 'approved'; reviewed_by = $REVIEWER })

  Assert-Write -Fix 'A5' -Id '21' -What 'reviewer cancels, leaving reviewed_by NULL - the check admits NULL deliberately' -Want 'succeeded' `
    -Response (Invoke-Rest -Path ("/pending_reviews?id=eq." + (Review '21')) -Token $TOK_REVIEWER -Method PATCH `
                 -Prefer 'return=representation' -Body @{ status = 'cancelled' })
}

function Invoke-A6 {
  Assert-Rpc -Fix 'A6' -Id '22' -What 'member who is not the named reviewer approves an unassigned gate (the hole)' -Want 'NOT_A_REVIEWER' `
    -Response (Invoke-Rest -Path '/rpc/complete_gate_review' -Token $TOK_MEMBER -Method POST `
                 -Body @{ p_pending_review_id = (Review '22'); p_decision = 'approved'; p_comment = 'pc' })

  Assert-Rpc -Fix 'A6' -Id '23' -What 'the gate''s named reviewer approves it' -Want 'success' `
    -Response (Invoke-Rest -Path '/rpc/complete_gate_review' -Token $TOK_REVIEWER -Method POST `
                 -Body @{ p_pending_review_id = (Review '23'); p_decision = 'approved'; p_comment = 'pc' })

  Assert-Rpc -Fix 'A6' -Id '24' -What 'an administrator stands in for the reviewer (deliberate override)' -Want 'success' `
    -Response (Invoke-Rest -Path '/rpc/complete_gate_review' -Token $TOK_ALICE -Method POST `
                 -Body @{ p_pending_review_id = (Review '24'); p_decision = 'approved'; p_comment = 'pc' })

  Assert-Rpc -Fix 'A6' -Id '25' -What 'gate names NO reviewers: member without module:reviews:edit approves' -Want 'NOT_A_REVIEWER' `
    -Response (Invoke-Rest -Path '/rpc/complete_gate_review' -Token $TOK_MEMBER -Method POST `
                 -Body @{ p_pending_review_id = (Review '25'); p_decision = 'approved'; p_comment = 'pc' })

  Assert-Rpc -Fix 'A6' -Id '26' -What 'gate names NO reviewers: holder of module:reviews:edit approves' -Want 'success' `
    -Response (Invoke-Rest -Path '/rpc/complete_gate_review' -Token $TOK_REVIEWER -Method POST `
                 -Body @{ p_pending_review_id = (Review '26'); p_decision = 'approved'; p_comment = 'pc' })

  Assert-Rpc -Fix 'A6' -Id '27' -What 'review assigned to somebody else (pre-existing term, must stay)' -Want 'NOT_ASSIGNED' `
    -Response (Invoke-Rest -Path '/rpc/complete_gate_review' -Token $TOK_MEMBER -Method POST `
                 -Body @{ p_pending_review_id = (Review '27'); p_decision = 'approved'; p_comment = 'pc' })

  # A's edge case: reviewer_type 'group' has never been matched by any code in
  # the schema, and what changed in 95 is the direction of the consequence -
  # such a gate used to be approvable by any member and is now admin-only.
  Assert-Rpc -Fix 'A6' -Id '27b' -What "gate whose only reviewer rows are reviewer_type='group': member approves" -Want 'NOT_A_REVIEWER' `
    -Response (Invoke-Rest -Path '/rpc/complete_gate_review' -Token $TOK_MEMBER -Method POST `
                 -Body @{ p_pending_review_id = (Review '2b'); p_decision = 'approved'; p_comment = 'pc' })

  # The equivalence A asked for, and the thing a future edit breaks first: the
  # list a user is offered and the set the database accepts from them are one
  # question. Reviews 22, 25 and 27b were all just refused to member, so none of
  # them may appear in member's own pending list.
  $r = Invoke-Rest -Path '/rpc/get_my_pending_reviews' -Token $TOK_MEMBER -Method POST -Body @{}
  $body = '' + $r.Body
  $offered = @()
  foreach ($suffix in @('22','25','2b')) {
    if ($body -match [regex]::Escape((Review $suffix))) { $offered += (Review $suffix) }
  }
  Assert-Fact -Fix 'A6' -Id '28eq' `
    -What 'get_my_pending_reviews offers member nothing complete_gate_review would refuse them' `
    -Want 'agree' -Got $(if ($offered.Count -eq 0) { 'agree' } else { 'disagree' }) `
    -Evidence ("HTTP {0}; offered-but-refused: {1}; body {2}" -f `
               $r.Status, $(if ($offered.Count) { $offered -join ', ' } else { 'none' }), (Trunc $body 200))
}

function Invoke-A7 {
  $now = (Get-Date).ToUniversalTime().ToString('o')

  Assert-Write -Fix 'A7' -Id '28' -What 'editor with edit and NOT delete trashes a file (the finding)' -Want 'refused' `
    -Response (Invoke-Rest -Path "/files?id=eq.$F_TRASH" -Token $TOK_EDITOR -Method PATCH `
                 -Prefer 'return=representation' -Body @{ deleted_at = $now; deleted_by = $EDITOR })

  Assert-Write -Fix 'A7' -Id '29' -What 'deleter with module:explorer:delete trashes the same file' -Want 'succeeded' `
    -Response (Invoke-Rest -Path "/files?id=eq.$F_TRASH" -Token $TOK_DELETER -Method PATCH `
                 -Prefer 'return=representation' -Body @{ deleted_at = $now; deleted_by = $DELETER })

  Assert-Write -Fix 'A7' -Id '30' -What 'editor still renames a live file - the common path (regression control)' -Want 'succeeded' `
    -Response (Invoke-Rest -Path "/files?id=eq.$F_LIVE" -Token $TOK_EDITOR -Method PATCH `
                 -Prefer 'return=representation' -Body @{ file_name = 'renamed-by-editor.sldprt' })

  Assert-Write -Fix 'A7' -Id '31' -What 'editor still restores a trashed file - putting one back needs only edit' -Want 'succeeded' `
    -Response (Invoke-Rest -Path "/files?id=eq.$F_TRASHED" -Token $TOK_EDITOR -Method PATCH `
                 -Prefer 'return=representation' -Body @{ deleted_at = $null; deleted_by = $null })
}

$Fixes = @(
  @{ Id = 'A1a'; What = 'users self-update: WITH CHECK pinning role and org_id'
     Run = ${function:Invoke-A1a}; Revert = '/sql/revert-a1a.sql'
     Objects = @(@{ Kind = 'policy'; Table = 'users'; Name = 'Users can update their own profile' })
     Flips = @('1','2','3')
     NotFlipping = "5 stays refused either way: anon has no auth.uid(), so `id = auth.uid()` matches no row with or without the TO qualifier. It is defence in depth, not a reproduction. 4 is a regression control and must hold in both phases." }

  @{ Id = 'A1b'; What = 'users admin-update: the WITH CHECK A says is a no-op'
     Run = ${function:Invoke-A1b}; Revert = '/sql/revert-a1b.sql'
     Objects = @(@{ Kind = 'policy'; Table = 'users'; Name = 'Admins can update org users' })
     Flips = @()
     NotFlipping = "Nothing is expected to flip, and that is the finding rather than a gap. A states the added WITH CHECK restates the USING expression exactly and is semantically a no-op. Running the revert phase with an empty Flips list is how that claim gets executed instead of believed: if anything DID flip, A's reasoning would be wrong." }

  @{ Id = 'A3'; What = 'share-link INSERT: file must be in the caller''s org, created_by must be the caller'
     Run = ${function:Invoke-A3}; Revert = '/sql/revert-a3.sql'
     Objects = @(@{ Kind = 'policy'; Table = 'file_share_links'; Name = 'Engineers can create share links' })
     Flips = @('9','10')
     NotFlipping = "11 is refused by the module:explorer:create term, which predates schema 95 and is unchanged. 12 is the regression control." }

  @{ Id = 'A4'; What = 'share-link UPDATE: revocation is the only update admitted'
     Run = ${function:Invoke-A4}; Revert = '/sql/revert-a4.sql'
     Objects = @(@{ Kind = 'policy'; Table = 'file_share_links'; Name = 'Users can update own share links' })
     Flips = @('13','14')
     NotFlipping = "15 is A's own caveat: rewriting org_id was 'not reachable in practice, but only because PostgREST could not read the row back - the SELECT policy, not this one'. Whether it flips is therefore a fact about the SELECT policy, and pinning it here would attribute the refusal to the wrong clause. 17 is refused by created_by in USING, unchanged. 16 is the regression control." }

  @{ Id = 'A5'; What = 'pending_reviews UPDATE: needs module:reviews:edit, reviewed_by must be the caller'
     Run = ${function:Invoke-A5}; Revert = '/sql/revert-a5.sql'
     Objects = @(@{ Kind = 'policy'; Table = 'pending_reviews'; Name = 'Users can update pending reviews' })
     Flips = @('18','19')
     NotFlipping = "20 and 21 are regression controls and must hold in both phases." }

  @{ Id = 'A6'; What = 'complete_gate_review: an unassigned gate is decided by its reviewers'
     Run = ${function:Invoke-A6}; Revert = '/sql/revert-a6.sql'
     Objects = @(@{ Kind = 'function'; Name = 'may_review_gate(uuid,uuid)' })
     Flips = @('22','25','27b')
     NotFlipping = "27 exercises the assigned branch, which schema 95 did not touch. 23, 24 and 26 are positive controls. 28eq compares two functions that both call may_review_gate, so the mutant moves both together and the equivalence is preserved by construction - it is an assertion about the fixed release, not a reproduction." }

  @{ Id = 'A7'; What = 'files UPDATE: trashing needs module:explorer:delete, not edit'
     Run = ${function:Invoke-A7}; Revert = '/sql/revert-a7.sql'
     Objects = @(@{ Kind = 'policy'; Table = 'files'; Name = 'Engineers can update files' })
     Flips = @('28')
     NotFlipping = "29, 30 and 31 are the three regression controls: delete still works for a holder of delete, the common rename path is untouched, and restoring from the trash still needs only edit." }
)

# --------------------------------------------------------------- preflight ---
Write-Host "`n=== SCHEMA 95 POLICY CONTROLS ===" -ForegroundColor Yellow

$release = Get-Scalar 'SELECT schema_release_version()'
if ($release -notmatch '^\d+$') {
  Write-Host "ABORT: schema_release_version() did not answer. Run .\reset.ps1 first." -ForegroundColor Red
  exit 2
}
Write-Host "schema release under test: $release" -ForegroundColor Green

$ping = Invoke-Rest -Path '/' -Token $TOK_ANON
if ($ping.Status -ne 200) {
  Write-Host "ABORT: PostgREST at $RestUrl did not answer (status $($ping.Status))." -ForegroundColor Red
  exit 2
}

$snapshotOut = Invoke-PsqlFile -File '/sql/policy-snapshot.sql' -StopOnError
if ($snapshotOut -cmatch 'ERROR:') {
  Write-Host "ABORT: could not install the snapshot helper." -ForegroundColor Red
  Write-Host $snapshotOut
  exit 2
}

Reset-Fixtures
Write-Host "fixtures applied; PostgREST is answering." -ForegroundColor Green

# Snapshot every object a revert will overwrite, from the live catalogue, before
# anything is touched. A run that cannot snapshot must not proceed: it would
# have no way to put the schema back.
foreach ($fix in $Fixes) {
  foreach ($obj in $fix.Objects) {
    $sql = if ($obj.Kind -eq 'policy') {
      "SELECT harness.snapshot_policy('$($obj.Table)', '$($obj.Name)') IS NOT NULL"
    } else {
      "SELECT harness.snapshot_function('$($obj.Name)') IS NOT NULL"
    }
    $result = Invoke-Sql $sql
    if ($result -ne 't') {
      Write-Host ("ABORT: could not snapshot {0} {1}. Reverting without a restore path is not something this script will do." `
        -f $obj.Kind, $(if ($obj.Table) { "$($obj.Table).$($obj.Name)" } else { $obj.Name })) -ForegroundColor Red
      Write-Host $result -ForegroundColor Red
      exit 2
    }
  }
}
Write-Host ("snapshotted {0} object(s) for restore" -f ($Fixes | ForEach-Object { $_.Objects.Count } | Measure-Object -Sum).Sum) -ForegroundColor Green

function Restore-Objects {
  param($Fix)
  foreach ($obj in $Fix.Objects) {
    $sql = if ($obj.Kind -eq 'policy') {
      "SELECT harness.restore_policy('$($obj.Table)', '$($obj.Name)') IS NOT NULL"
    } else {
      "SELECT harness.restore_function('$($obj.Name)') IS NOT NULL"
    }
    $result = Invoke-Sql $sql
    if ($result -ne 't') {
      Write-Host ("  RESTORE FAILED for {0}: {1}" -f $obj.Name, $result) -ForegroundColor Red
      $script:Failures += "$($Fix.Id) (restore failed - the database is left reverted)"
    }
  }
}

# ------------------------------------------------------- phase 1: the release --
Write-Host "`n--- PHASE 1: schema $release as it stands. Every assertion Agent A published must hold." -ForegroundColor Yellow

foreach ($fix in $Fixes) {
  if ($Only.Count -gt 0 -and $Only -notcontains $fix.Id) { continue }
  Write-Host "`n$($fix.Id)  $($fix.What)" -ForegroundColor Cyan
  $script:Ran = $script:Ran + 1
  Reset-Fixtures
  $script:Phase = 'fixed'
  & $fix.Run
}

# ------------------------------------------------- phase 2: one fix reverted --
if ($NoReverts) {
  Write-Host "`n-NoReverts: the revert phase was skipped. Phase 1 on its own cannot tell an assertion that proves a fix from one that would pass against the unfixed schema." -ForegroundColor Yellow
} else {
  Write-Host "`n--- PHASE 2: each fix reverted to its schema-94 text, one at a time. The assertions that close a hole must now report it open." -ForegroundColor Yellow

  foreach ($fix in $Fixes) {
    if ($Only.Count -gt 0 -and $Only -notcontains $fix.Id) { continue }
    Write-Host "`n$($fix.Id) reverted  <- $($fix.Revert)" -ForegroundColor Magenta

    Reset-Fixtures
    $applied = Invoke-PsqlFile -File $fix.Revert -StopOnError
    if ($applied -cmatch 'ERROR:') {
      Write-Host "  the revert did not apply, so this fix has no executed control:" -ForegroundColor Red
      Write-Host $applied
      $script:Failures += "$($fix.Id) (revert failed to apply)"
      Restore-Objects -Fix $fix
      continue
    }

    $script:Phase = 'reverted'
    & $fix.Run
    $script:Phase = 'fixed'

    Restore-Objects -Fix $fix
    Reset-Fixtures

    # Did the assertions that are supposed to prove this fix actually notice?
    #
    # Computed once, here, and stored - the summary at the bottom reads this
    # rather than working it out again. The first version of this file did work
    # it out twice, and the two answers disagreed: the line below said A1a was
    # proven and the summary said NOT PROVEN, in the same run. The cause was a
    # nested `Where-Object` whose inner block could not see the loop variable
    # the outer one had just assigned, so it silently matched nothing. Which of
    # the two was right is beside the point; a report that contradicts itself
    # cannot be used to decide a release, and the fix is to have one answer
    # rather than two agreeing answers.
    $reverted = @($script:Rows | Where-Object { $_.Fix -eq $fix.Id -and $_.Phase -eq 'reverted' })
    $inert    = @()
    $flipped  = @()
    foreach ($id in $fix.Flips) {
      $row = $reverted | Where-Object { $_.Id -eq $id } | Select-Object -First 1
      # "Flipped" means the assertion no longer holds - the hole is open again.
      if ($null -eq $row) { $inert += "$id (not run)" }
      elseif ($row.Ok)    { $inert += "$id (still '$($row.Got)' with the fix reverted)" }
      else                { $flipped += $id }
    }
    $script:FlipResults[$fix.Id] = [pscustomobject]@{
      Expected = @($fix.Flips); Flipped = $flipped; Inert = $inert
      Unexpected = @($reverted | Where-Object { -not $_.Ok -and $fix.Flips -notcontains $_.Id } | ForEach-Object { $_.Id })
    }

    if ($fix.Flips.Count -eq 0) {
      $moved = @($script:FlipResults[$fix.Id].Unexpected)
      if ($moved.Count -eq 0) {
        Write-Host "  as documented: nothing changed when this was reverted." -ForegroundColor DarkGray
      } else {
        Write-Host ("  UNEXPECTED: {0} assertion(s) changed under a revert documented as a no-op: {1}" `
          -f $moved.Count, ($moved -join ', ')) -ForegroundColor Red
        $script:Failures += "$($fix.Id) (a revert documented as semantically inert changed behaviour)"
      }
    } elseif ($inert.Count -gt 0) {
      Write-Host ("  INERT CONTROL: {0}. These assertions pass with the fix reverted, so they are not evidence of it." `
        -f ($inert -join '; ')) -ForegroundColor Red
      $script:Failures += "$($fix.Id) (inert control: $($inert -join '; '))"
    } else {
      Write-Host ("  proven: assertion(s) {0} report the hole open with the fix reverted, and closed with it in place." `
        -f ($flipped -join ', ')) -ForegroundColor Green
    }
    if ($fix.NotFlipping) { Write-Host ("  not expected to flip - {0}" -f $fix.NotFlipping) -ForegroundColor DarkGray }
  }
}

# ------------------------------------------------------ B8(a): storage.objects --
if ($Only.Count -eq 0 -or $Only -contains 'B8a') {
  Write-Host "`n--- B8(a): storage.objects" -ForegroundColor Cyan
  $script:Ran = $script:Ran + 1
  $script:Phase = 'fixed'

  $built = Invoke-PsqlFile -File '/sql/storage-objects-fixture.sql' -StopOnError
  if ($built -cmatch 'ERROR:') {
    Write-Host "  the storage fixture did not build:" -ForegroundColor Red
    Write-Host $built
    $script:Failures += 'B8a (fixture failed to build)'
  } else {
    $probe = Invoke-PsqlFile -File '/sql/storage-cross-tenant-read.sql' -StopOnError
    Write-Host (($probe -split "`n" | Select-String -Pattern '(BOB_|ALICE_|POLICY=|RLS_ENABLED=)' `
                 | ForEach-Object { '            ' + $_.ToString().Trim() }) -join "`n") -ForegroundColor DarkGray

    # 't', not 'true': psql -tAq renders a boolean as a single character, and a
    # control that expects the wrong spelling reports a correct database broken.
    Assert-Fact -Fix 'B8a' -Id 'S1' -What 'storage.objects exists in the harness and has RLS enabled' `
      -Want 't' -Got (Get-Scalar "SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='storage' AND c.relname='objects'") `
      -Evidence 'Supabase ships storage.objects with RLS on; with RLS off no policy is consulted and the bucket is open by construction.'

    Assert-Fact -Fix 'B8a' -Id 'S2' -What 'the fixture carries one object for each of two tenants' `
      -Want '2' -Got (Get-Scalar "SELECT count(*) FROM storage.objects WHERE bucket_id='vault'") `
      -Evidence 'Paths are {org_id}/{hash[0:2]}/{hash}, so (storage.foldername(name))[1] is the owning organization.'

    # THE CROSS-TENANT READ CONTROL - PENDING A2
    #
    # A2 did not land: PHASE0_STORAGE_POLICIES.md does not exist, so there are
    # no committed policies for this to be a control ON. With RLS enabled and
    # zero policies, authenticated reads nothing - so "Bob cannot read Acme's
    # object" is true right now and means nothing at all, because Alice cannot
    # read her own either. Reporting that as a pass would be the exact failure
    # this whole assignment is about: a check that certifies a property it is
    # not testing.
    $policyCount = [int](Get-Scalar "SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects'")
    if ($policyCount -eq 0) {
      Write-Host "  [n/a]     cross-tenant read: NOT APPLICABLE, pending A2." -ForegroundColor DarkGray
      Write-Host "            No policy exists on storage.objects, so authenticated reads nothing and a refusal proves nothing." -ForegroundColor DarkGray
      Write-Host "            When A2 lands, this asserts: Bob reads 0 of Acme's objects, Bob reads 1 of Umbrella's, Alice reads 1 of Acme's." -ForegroundColor DarkGray
      Write-Host "            Expected policy names (A_AGENT_REPORT.md section 4): Vault objects are readable / written / replaced / removed within their organization." -ForegroundColor DarkGray
    } else {
      $bobAcme   = ($probe -match 'BOB_READS_ACME=0')
      $bobOwn    = ($probe -match 'BOB_READS_OWN=1')
      $aliceOwn  = ($probe -match 'ALICE_READS_OWN=1')
      Assert-Fact -Fix 'B8a' -Id 'S3' -What 'Umbrella member reads none of Acme''s vault objects' `
        -Want 'yes' -Got $(if ($bobAcme) { 'yes' } else { 'no' }) -Evidence (Trunc $probe 300)
      Assert-Fact -Fix 'B8a' -Id 'S4' -What 'Umbrella member still reads their own, and Acme member still reads theirs (regression control)' `
        -Want 'yes' -Got $(if ($bobOwn -and $aliceOwn) { 'yes' } else { 'no' }) -Evidence (Trunc $probe 300)
    }

    # A's claim about the new verify-schema.sql storage section, executed. It is
    # advisory throughout and must never withhold the stamp: a database whose
    # storage policies are unknown must still be verifiable, or the check is one
    # nobody can clear.
    Invoke-PsqlFile -File '/blueplm/tools/verify-schema.sql' | Out-Null
    Assert-Fact -Fix 'B8a' -Id 'S5' -What 'verify-schema still stamps the release with storage.objects present, RLS on and ZERO policies' `
      -Want $release -Got (Get-Scalar 'SELECT version FROM schema_version WHERE id = 1') `
      -Evidence 'A_AGENT_REPORT.md section 4: the storage section is advisory throughout and does not withhold the stamp.'

    Invoke-Sql 'ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY' | Out-Null
    $rlsOff = Invoke-PsqlFile -File '/blueplm/tools/verify-schema.sql'
    Assert-Fact -Fix 'B8a' -Id 'S6' -What 'verify-schema warns when RLS is OFF on storage.objects' `
      -Want 'warned' -Got $(if ($rlsOff -match '(?i)storage' -and $rlsOff -match '(?i)row.level security|RLS') { 'warned' } else { 'silent' }) `
      -Evidence (($rlsOff -split "`n" | Select-String -Pattern '(?i)storage' | Select-Object -First 4) -join ' | ')
    Assert-Fact -Fix 'B8a' -Id 'S7' -What '...and still stamps, because an unknown storage posture must not block verification' `
      -Want $release -Got (Get-Scalar 'SELECT version FROM schema_version WHERE id = 1') `
      -Evidence 'A check that blocks on unknown policies is a check nobody can clear.'
    Invoke-Sql 'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY' | Out-Null
  }
}

# ------------------------------------------------------------------ verdict --
Write-Host "`n=== VERDICT ===" -ForegroundColor Yellow

$transport = @(Get-RestTransportFailures)
if ($transport.Count -gt 0) {
  Write-Host ("FAIL: {0} request(s) never reached the server: {1}. A connection failure is not a refusal; this run proves nothing." `
    -f $transport.Count, ($transport -join ', ')) -ForegroundColor Red
  $script:Failures += 'transport failures'
}

$fixedRows = @($script:Rows | Where-Object { $_.Phase -eq 'fixed' })
$bad       = @($fixedRows | Where-Object { -not $_.Ok })

Write-Host ("{0} assertion(s) run against schema {1}; {2} did not hold." -f $fixedRows.Count, $release, $bad.Count) `
  -ForegroundColor $(if ($bad.Count) { 'Red' } else { 'Green' })

if ($bad.Count -gt 0) {
  Write-Host "`nAssertions that did not hold against the release as it stands:" -ForegroundColor Red
  foreach ($row in $bad) {
    Write-Host ("  {0}/{1}  {2}" -f $row.Fix, $row.Id, $row.What) -ForegroundColor Red
    Write-Host ("        wanted '{0}', got '{1}'" -f $row.Want, $row.Got) -ForegroundColor DarkGray
    Write-Host ("        {0}" -f $row.Evidence) -ForegroundColor DarkGray
  }
  $script:Failures += ("{0} assertion(s) failed against the release" -f $bad.Count)
}

# Per-fix proven / not proven. This is the line the release decision rests on,
# so it is printed whether the run passed or failed.
if (-not $NoReverts) {
  Write-Host "`nPer fix - is it proven by an executed control?" -ForegroundColor Yellow
  foreach ($fix in $Fixes) {
    if ($Only.Count -gt 0 -and $Only -notcontains $fix.Id) { continue }
    $result = $script:FlipResults[$fix.Id]
    if ($null -eq $result) {
      Write-Host ("  {0}  NOT PROVEN - the revert phase did not run for it" -f $fix.Id.PadRight(4)) -ForegroundColor Red
    } elseif ($result.Expected.Count -eq 0) {
      Write-Host ("  {0}  no-op by design - nothing to flip, and nothing did" -f $fix.Id.PadRight(4)) -ForegroundColor DarkGray
    } elseif ($result.Inert.Count -eq 0) {
      Write-Host ("  {0}  PROVEN by {1} of {2} - assertion(s) {3} flip when it is reverted" `
        -f $fix.Id.PadRight(4), $result.Flipped.Count, $result.Expected.Count, ($result.Flipped -join ', ')) -ForegroundColor Green
    } else {
      Write-Host ("  {0}  NOT PROVEN - {1}" -f $fix.Id.PadRight(4), ($result.Inert -join '; ')) -ForegroundColor Red
    }
  }
}

# The schema must be back where it started, or a later suite inherits a hole
# this one opened. Asked of the catalogue, not assumed from the restore calls.
Invoke-PsqlFile -File '/blueplm/tools/verify-schema.sql' | Out-Null
$stamped = Get-Scalar 'SELECT version FROM schema_version WHERE id = 1'
if ($stamped -ne $release) {
  Write-Host ("`nFAIL: the database no longer verifies clean - schema_release_version() says {0}, the stamp says {1}." -f $release, $stamped) -ForegroundColor Red
  $script:Failures += 'left the database unverifiable'
}

# may_review_gate() is REVOKEd from PUBLIC, anon and authenticated by the
# module, and A6's revert replaces its body. CREATE OR REPLACE preserves an
# existing function's ACL, so the revoke should have survived - asked rather
# than assumed, because a control that quietly grants anon EXECUTE on an
# authorization helper would be worse than the defect it was testing.
$reachable = Get-Scalar "SELECT has_function_privilege('authenticated', 'may_review_gate(uuid,uuid)', 'EXECUTE')"
if ($reachable -ne 'f') {
  Write-Host ("`nFAIL: may_review_gate is executable by authenticated after this run (has_function_privilege said '{0}'). The A6 revert changed its grants." -f $reachable) -ForegroundColor Red
  $script:Failures += 'A6 revert left may_review_gate reachable'
}

if ($script:Ran -eq 0) {
  Write-Host "`nFAIL: no fix was exercised. A suite that runs nothing cannot report success." -ForegroundColor Red
  $script:Failures += 'nothing ran'
}

if ($script:Failures.Count -gt 0) {
  Write-Host ("`nFAIL: {0}" -f ($script:Failures -join '; ')) -ForegroundColor Red
  exit 1
}
Write-Host ("`nOK: {0} assertions held against schema {1}, every fix with a reproducible hole was proven by reverting it, and the database still verifies clean." `
  -f $fixedRows.Count, $release) -ForegroundColor Green
exit 0
