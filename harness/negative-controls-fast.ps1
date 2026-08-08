# Negative controls for the verifier, arranged so that the suite is cheap enough
# to actually run.
#
# THIS FILE DOES NOT REPLACE negative-controls.ps1 UNTIL SOMEBODY DIFFS THEM
#
# It is a second implementation of the same controls, added alongside the
# original rather than on top of it. `-Tier full` is written to reach exactly the
# verdicts negative-controls.ps1 reaches, control for control, so the two can be
# run against two fresh resets and compared. Until that comparison has been done
# and read, the original is the release gate and this is a convenience.
#
# WHERE THE TIME WENT (derived from the code, NOT measured - see FAST-SUITE.md)
#
#   1. negative-controls.ps1 runs tools/verify-schema.sql 40 times. Each run
#      calls check_null_unsafe_org_gates() and check_unbound_entity_args() three
#      times apiece - twice in the report blocks and once inside
#      verify_and_stamp_schema() - and both scan every function body in public
#      through strip_sql_noise(), a PL/pgSQL loop that walks the text one
#      character at a time. Six full passes over roughly a quarter of a million
#      characters, per verification. Nothing in THIS file can remove that: it
#      lives in supabase/core.sql, which is the artefact under test.
#      sql/fast/strip-sql-noise-fast.sql is an opt-in, proof-gated replacement
#      for development loops, and it is not for release gates.
#   2. It spawns 147 `docker compose exec` processes, one per SQL statement or
#      file. Compose parses the project and resolves the container on every one.
#      This file spawns 29 in the standard tier and 4 in smoke, by putting the
#      statements that belong to one control into one psql session.
#   3. Eighteen of the repairs re-apply a whole file; five of those are release
#      module files, and two of the five are 10-source-files.sql at 227 KB.
#
# So the floor is (number of verification runs) x (cost of one verification),
# and the tiers below are mostly a way of choosing that number: 40 in the
# original, 45 in -Tier full (which adds two controls and a stronger stamp
# assertion), 25 in -Tier standard, 1 in -Tier smoke.
#
# The claims the assignment offered that did NOT survive contact with the code:
# there are no fixed sleeps of any consequence (reset.ps1 polls the container
# healthcheck, rest-ready.ps1 polls PostgREST), no container restarts, and no
# database rebuilds inside the suite. The waste is verification runs and process
# spawns, in that order, and the second is much smaller than the first.
#
# TIERS
#
#   -Tier smoke     Every hole applied at once inside one transaction, ONE
#                   verification, then ROLLBACK. Four psql sessions in total and
#                   exactly one verification run: the baseline is read from the
#                   stamp rather than re-verified, nothing is repaired because
#                   nothing was committed, and there is no final verification
#                   because the signature taken after the rollback already shows
#                   the catalogue came back. NC7, STAMP and POSTURE are off
#                   unless named in -Only:
#                   between them they cost three more verification runs, which is
#                   more than this tier's entire budget. Intended for every
#                   commit. Weaker than the others in one further stated way: a
#                   hole that masked another hole would not be noticed, so a
#                   smoke pass is not a release signal. It fails loudly, naming
#                   the control, whenever a hole's tokens cannot be found - which
#                   is the shape masking takes.
#
#   -Tier standard  Each control isolated, inside its own transaction, verified
#                   once, then ROLLBACK. Restoration is byte-identical because
#                   nothing was committed, so there is no repair phase and no
#                   second verification. Halves the number of verification runs.
#                   Weaker than full in one stated way: it does not assert that
#                   re-running the named module file repairs the hole, and it
#                   reads "the stamp was withheld" from the refusal rather than
#                   from schema_version. Both are asserted once per run instead
#                   of eighteen times - see -Tier full and the STAMP WITHHELD
#                   control below.
#
#   -Tier full      The original flow: apply the hole, verify, repair with the
#                   named files, verify again, clean up. Same assertions, same
#                   regexes, same evidence. This is the release gate.
#
# -Only takes control ids and, unlike the original, it really does filter
# everything: negative-controls.ps1 guards Test-Control with -Only but runs NC7
# and the posture checks unconditionally, so `-Only NC1` runs NC1, NC7 and the
# posture block and then reports "FAIL: no control executed" because $Ran was
# never incremented for NC7. NC7 and POSTURE are ordinary ids here.
param(
  [int]$ExpectRelease = 0,
  [string[]]$Only = @(),
  [ValidateSet('smoke','standard','full')]
  [string]$Tier = 'standard',
  # Print the elapsed seconds of every psql round trip. This is how to find out
  # what the cost model above got wrong.
  [switch]$Timing,
  # Deliberately break each control and require this script to report it broken.
  # A verifier whose failure path is dead code passes everything, which is the
  # defect this whole suite exists to catch, and it applies to the suite too.
  [switch]$SelfTest
)

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

# ---------------------------------------------------------------------------
# One psql session per phase, not one per statement.
#
# SQL goes in on stdin and stderr is merged inside the container, both for the
# reasons written at the top of tooling-controls.ps1: PowerShell mangles quotes
# on their way to a native command, and renders each stderr line as a
# hard-wrapped ErrorRecord that breaks -match on any identifier long enough to
# matter.
#
# NOTHING HERE DEPENDS ON THE ORDER OF THE MERGED STREAMS
#
# psql block-buffers stdout when it is not a terminal and writes stderr
# unbuffered, so an `\echo` marker cannot be relied on to arrive before the
# NOTICEs it is supposed to precede. Every phase below is therefore split into
# its own session, and every value this script reads back is carried on a
# self-identifying line (@@NC|...) that can be found anywhere in the output.
# ---------------------------------------------------------------------------
$script:Elapsed = 0.0

function Invoke-PsqlSession {
  param([string]$Script, [string]$AsRole = 'postgres', [string]$Label = '')
  # LF only. psql's slash-command lexer treats CR as whitespace, so a CRLF
  # script happens to work, but a path argument that picked one up would fail
  # to open and the failure would read as a missing fixture.
  $body = ($Script -replace "`r`n", "`n")
  $started = Get-Date
  $out = ($body | docker compose exec -T -e PGPASSWORD=postgres -e PGCLIENTENCODING=UTF8 db `
            bash -c "psql --no-psqlrc -U $AsRole -d postgres -h 127.0.0.1 2>&1" | Out-String)
  $seconds = ((Get-Date) - $started).TotalSeconds
  $script:Elapsed = $script:Elapsed + $seconds
  if ($Timing) {
    Write-Host ("      [{0,6:N1}s] {1}" -f $seconds, $Label) -ForegroundColor DarkGray
  }
  return $out
}

# Every session starts the same way. synchronous_commit is a durability setting
# on a container that is thrown away after every run, and it is the one server
# knob that can be turned from inside a session rather than at start-up.
# docker-compose.fast.yml turns off the other two.
$PREAMBLE = @'
\pset pager off
\set ON_ERROR_STOP off
SET synchronous_commit = off;
SET client_min_messages = notice;
'@

# A value read back out of a session. Returns '' when the line is absent, which
# is meaningful: a session that exited early never printed it.
function Get-Emitted {
  param([string]$Output, [string]$Key)
  $m = [regex]::Match($Output, ('@@NC\|' + [regex]::Escape($Key) + '\|(.*)'))
  if (-not $m.Success) { return '' }
  return $m.Groups[1].Value.Trim()
}

function Emit {
  param([string]$Key, [string]$Expression)
  # The marker is assembled from two literals so that it does not appear
  # contiguously in the statement text. When a statement fails, psql echoes the
  # offending line as `LINE 1: SELECT ...`, and if the marker were one literal
  # that echo would match Get-Emitted's pattern - so a failed read would return
  # the text of its own error message instead of ''. That is not hypothetical:
  # catalog_signature() failed to be created on every run, the signature read
  # returned "' || COALESCE((S..." out of the error echo, the `-eq ''` abort
  # guard was satisfied by it, and because the same error text came back every
  # time, every rollback compared equal and the restoration check was dead.
  # At run time the concatenation still produces @@NC|key|value on one line.
  return ("SELECT '@@' || 'NC|" + $Key + "|' || COALESCE((" + $Expression + ")::text, 'null') AS emitted;`n")
}

# Mirrors Get-StampedVersion in the original: -1 rather than an exception when
# the stamp is missing or unreadable, because the controls use "did not advance"
# as a signal and a cast error in the middle of one would read as the harness
# breaking rather than as the verifier withholding a stamp.
function ConvertTo-StampedVersion {
  param([string]$Value)
  if ($Value -notmatch '^-?\d+$') { return -1 }
  return [int]$Value
}

$script:Failures = @()
$script:Ran = 0
$script:Verifies = 0

function Add-Failure {
  param([string]$Reason)
  $script:Failures += $Reason
}

# ---------------------------------------------------------------------------
# The controls, as data. Identical in every field to the Test-Control calls in
# negative-controls.ps1 - hole file, expected tokens, repair files, cleanup
# files, the role the hole is applied as. Anything that differs there must
# differ here or the two suites are not testing the same thing.
#
# RepairIsRemedy marks the controls whose repair is the interesting half: NC6
# and NC16 repair by running the remedy the verifier prints rather than by
# removing the object, NC12 by running the remediation, and NC1/NC2/NC17/NC18/
# NC19 by re-applying the module file that owns the object. Those assertions do
# not survive rollback-based isolation, so -Tier standard reports them as not
# asserted rather than quietly dropping them.
# ---------------------------------------------------------------------------
$Controls = @(
  @{ Id='NC1';  What='finding 2: parts_with_pricing as a plain view, readable by anon'
     Hole='/sql/nc1-view-open.sql'; Tokens=@('anon-reachable')
     Repair=@('/blueplm/modules/30-supply-chain.sql'); Cleanup=@(); RepairIsRemedy=$true }

  @{ Id='NC2';  What='finding 3: create_file_share_link gating p_org_id, acting on p_file_id'
     Hole='/sql/nc2-unbound-file-arg.sql'; Tokens=@('unbound-entity-arg')
     Repair=@('/blueplm/modules/10-source-files.sql'); Cleanup=@(); RepairIsRemedy=$true }

  @{ Id='NC3';  What='finding 4: NOT IN (SELECT org_id FROM users ...)'
     Hole='/sql/nc3-null-unsafe-gate.sql'; Tokens=@('null-unsafe-gate')
     Repair=@('/sql/nc3-drop.sql'); Cleanup=@(); RepairIsRemedy=$false }

  @{ Id='NC4';  What='a function created later, born anon-executable'
     Hole='/sql/nc4-born-open.sql'; Tokens=@('anon-reachable')
     Repair=@('/sql/nc4-drop.sql'); Cleanup=@(); RepairIsRemedy=$false }

  @{ Id='NC5';  What='a leftover overload from a previous release'
     Hole='/sql/nc5-leftover-overload.sql'; Tokens=@('extra')
     Repair=@('/sql/nc5-drop.sql'); Cleanup=@(); RepairIsRemedy=$false }

  @{ Id='NC6';  What='a PROCEDURE in public that anon can call, cleared by the remedy the verifier prints'
     Hole='/sql/nc6-procedure-open.sql'; Tokens=@('anon-reachable')
     Repair=@('/sql/nc6-run-remedy.sql'); Cleanup=@('/sql/nc6-drop.sql'); RepairIsRemedy=$true }

  @{ Id='NC8';  What='a materialized view in public, readable by authenticated'
     Hole='/sql/nc8-matview.sql'; Tokens=@('materialized view')
     Repair=@('/sql/nc8-drop.sql'); Cleanup=@(); RepairIsRemedy=$false }

  @{ Id='NC9';  What='the NULL-unsafe membership test in four other spellings'
     Hole='/sql/nc9-null-unsafe-alt.sql'; Tokens=@('null-unsafe-gate')
     Repair=@('/sql/nc9-drop.sql'); Cleanup=@(); RepairIsRemedy=$false }

  @{ Id='NC10'; What='a function with no authorization that refuses the probe for another reason'
     Hole='/sql/nc10-ungated.sql'; Tokens=@('ungated')
     Repair=@('/sql/nc10-fix.sql'); Cleanup=@('/sql/nc10-drop.sql'); RepairIsRemedy=$true }

  @{ Id='NC11'; What='two entity ids, one checked, and no p_org_id anywhere'
     Hole='/sql/nc11-entity-gated.sql'; Tokens=@('unbound-entity-arg')
     Repair=@('/sql/nc11-fix.sql'); Cleanup=@('/sql/nc11-drop.sql'); RepairIsRemedy=$true }

  @{ Id='NC12'; What='a live cross-tenant share link left over from a release that closed the hole'
     Hole='/sql/nc12-residue-link.sql'; Tokens=@('cross_tenant_share_link','nc120000...')
     Repair=@('/sql/nc12-remediate.sql'); Cleanup=@('/sql/nc12-drop.sql'); RepairIsRemedy=$true }

  @{ Id='NC13'; What='no authorization at all, with auth.uid() as the only identity-shaped line'
     Hole='/sql/nc13-actor-stamp.sql'; Tokens=@('ungated','nc_actor_stamp_only')
     Repair=@('/sql/nc13-fix.sql'); Cleanup=@('/sql/nc13-drop.sql'); RepairIsRemedy=$true }

  @{ Id='NC14'; What='a partitioned table whose leaf has RLS and whose parent does not'
     Hole='/sql/nc14-partitioned.sql'; Tokens=@('anon-reachable','nc_partitioned_parts')
     Repair=@('/sql/nc14-drop.sql'); Cleanup=@(); RepairIsRemedy=$false }

  @{ Id='NC15'; What='RLS enabled and a policy that admits anon to every row'
     Hole='/sql/nc15-rls-admits-anon.sql'
     Tokens=@('anon-reachable','nc_rls_but_open','admits anon to every')
     Repair=@('/sql/nc15-drop.sql'); Cleanup=@(); RepairIsRemedy=$false }

  @{ Id='NC16'; What='a view anon can read one column of'
     Hole='/sql/nc16-column-grant-view.sql'; Tokens=@('anon-reachable','nc_column_grant_view')
     Repair=@('/sql/nc16-run-remedy.sql'); Cleanup=@('/sql/nc16-drop.sql'); RepairIsRemedy=$true }

  @{ Id='NC17'; What="consume_share_link restating validate_share_link's conditions instead of calling it"
     Hole='/sql/nc17-consume-restated.sql'; Tokens=@('stale','consume_share_link')
     Repair=@('/blueplm/modules/10-source-files.sql'); Cleanup=@(); RepairIsRemedy=$true }

  @{ Id='NC18'; What='seed_customer_categories granted back to authenticated, exactly as the default ACL had it'
     Hole='/sql/nc18-regrant-seed.sql'; Tokens=@('unverifiable','seed_customer_categories')
     Repair=@('/blueplm/modules/60-customers.sql'); Cleanup=@(); RepairIsRemedy=$true }

  @{ Id='NC19'; What='cleanup_extension_http_logs granted back to authenticated, exactly as the default ACL had it'
     Hole='/sql/nc19-regrant-cleanup-logs.sql'; Tokens=@('execute-not-withdrawn','cleanup_extension_http_logs')
     Repair=@('/blueplm/modules/50-extensions.sql'); Cleanup=@(); RepairIsRemedy=$true }

  # ------------------------------------------------------------------------
  # New. Each of these trips a branch of a check function in supabase/core.sql
  # that no existing control reaches, so a defect in it would read as a pass -
  # which is precisely how NC19 found `text[] || 'anon'` resolving to array_cat.
  # See FAST-SUITE.md for the full audit of never-executed failure branches.
  # ------------------------------------------------------------------------
  @{ Id='NX1';  What="check_release_residue's workflow-history branch, which no control has ever reached"
     Hole='/sql/fast/nx1-workflow-history-residue.sql'
     Tokens=@('cross_tenant_workflow_history','dddddddd-9991')
     Repair=@('/sql/fast/nx1-remediate.sql'); Cleanup=@('/sql/fast/nx1-drop.sql'); RepairIsRemedy=$true }

  @{ Id='NX2';  What="check_release_residue's workflow-assignment branch, likewise never reached"
     Hole='/sql/fast/nx2-workflow-assignment-residue.sql'
     Tokens=@('cross_tenant_workflow_assignment','aaaaaaaa-3333-4000-8000-000000000002')
     Repair=@('/sql/fast/nx2-remediate.sql'); Cleanup=@('/sql/fast/nx2-drop.sql'); RepairIsRemedy=$true }
)

function Test-Wanted {
  param([string]$Id)
  if ($Only.Count -eq 0) { return $true }
  return ($Only -contains $Id)
}

# ---------------------------------------------------------------------------
# Preamble: what release this is, and that it verifies clean before anything
# below touches it. Four psql round trips in the original, one here.
# ---------------------------------------------------------------------------
Write-Host "=== NEGATIVE CONTROLS (fast, tier: $Tier) ===" -ForegroundColor Yellow

$probe = Invoke-PsqlSession -Label 'preamble' -Script ($PREAMBLE + @'
SELECT '@@NC|has_release|' || (to_regprocedure('schema_release_version()') IS NOT NULL)::text AS emitted;
SELECT '@@NC|release|' || COALESCE((SELECT schema_release_version()::text), 'null') AS emitted
WHERE to_regprocedure('schema_release_version()') IS NOT NULL;
'@)

if ((Get-Emitted $probe 'has_release') -ne 'true') {
  Write-Host "ABORT: schema_release_version() is not installed on this database, so there is no release for the controls to be measured against. Run .\reset.ps1 first." -ForegroundColor Red
  exit 2
}
$releaseText = Get-Emitted $probe 'release'
if ($releaseText -notmatch '^\d+$') {
  Write-Host "ABORT: schema_release_version() did not answer with a number (got '$releaseText')." -ForegroundColor Red
  exit 2
}
$RELEASE = [int]$releaseText

if ($ExpectRelease -gt 0 -and $RELEASE -ne $ExpectRelease) {
  Write-Host ("ABORT: RELEASE MISMATCH - schema_release_version() says {0}, -ExpectRelease says {1}. The tree under test is not the release you asked for; nothing below would be measuring it." `
    -f $RELEASE, $ExpectRelease) -ForegroundColor Red
  exit 2
}

# The baseline has to verify clean, or every control below "fails verification"
# for free. This is also the run that establishes the catalogue signature the
# rollback tiers compare against.
#
# THE SMOKE TIER READS THE STAMP INSTEAD OF RE-EARNING IT
#
# A verification run is around half of the smoke tier's entire budget, spent to
# establish something the database is already carrying the evidence for: nothing
# but verify_and_stamp_schema() writes schema_version - core.sql revokes the
# function from every client role, update_schema_version() was reduced to a
# no-op precisely so that modules could not stamp, and the write only happens on
# an empty problem list. So schema_version = schema_release_version() means the
# last verification of this database passed.
#
# What that does not cover is a change made after the stamp - by hand, or by an
# earlier suite that left something behind. -Tier standard and -Tier full still
# verify here and pay for it. The smoke tier accepts the weaker premise, and it
# is one of the reasons a smoke pass is not a release signal.
$baselineScript = $PREAMBLE + "\i /sql/fast/nc-signature.sql`n"
if ($Tier -ne 'smoke') { $baselineScript += "\i /blueplm/tools/verify-schema.sql`n" }
$baselineScript += (Emit 'stamp' 'SELECT version FROM schema_version WHERE id = 1')
$baselineScript += (Emit 'signature' 'SELECT harness_fast.catalog_signature()')

$baseline = Invoke-PsqlSession -Label 'baseline verify + signature' -Script $baselineScript
if ($Tier -ne 'smoke') { $script:Verifies = $script:Verifies + 1 }

$baselineStamp = ConvertTo-StampedVersion (Get-Emitted $baseline 'stamp')
$baselineSignature = Get-Emitted $baseline 'signature'

if ($baselineStamp -ne $RELEASE) {
  Write-Host ("ABORT: the database does not verify clean before the controls start - schema_release_version() declares {0} and schema_version holds {1}." `
    -f $RELEASE, $(if ($baselineStamp -lt 0) { 'nothing readable' } else { $baselineStamp })) -ForegroundColor Red
  if ($Tier -eq 'smoke') {
    Write-Host "    The smoke tier reads the stamp rather than re-running the verification, so this is the last verification's verdict and not a fresh one. Run .\reset.ps1, or -Tier standard to see why." -ForegroundColor DarkGray
  }
  ($baseline -split "`n" | Select-String -Pattern 'WARNING|ERROR' | Select-Object -First 20) |
    ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
  exit 2
}
if ($baselineSignature -notmatch '^[0-9a-f]{32}$') {
  # Checked by shape, not against ''. The signature is an md5, so anything that
  # is not 32 hex digits is not a signature - including the empty string, 'null',
  # and the fragment of a psql error message that the old `-eq ''` test accepted
  # as an answer for as long as this file has existed.
  Write-Host ("ABORT: harness_fast.catalog_signature() did not answer with an md5 (got '{0}'). The rollback tiers have no baseline to compare against, and this script will not certify a restoration it cannot check." `
    -f $baselineSignature) -ForegroundColor Red
  Write-Host $baseline
  exit 2
}
Write-Host ("baseline verifies clean at {0} (read from schema_release_version()); catalogue signature {1}" `
  -f $RELEASE, $baselineSignature.Substring(0, [Math]::Min(16, $baselineSignature.Length))) -ForegroundColor Green

# ---------------------------------------------------------------------------
# Scoring, in one place so that the three tiers cannot disagree about what a
# catch is.
#
# The token test is the original's, character for character: every entry of
# ExpectToken must appear somewhere in the verification output, matched as a
# literal. -Tier smoke additionally requires them to appear on ONE problem row,
# which is stricter, and says so when it is the reason a control failed.
# ---------------------------------------------------------------------------
function Test-Caught {
  param([string]$Id, [string]$What, [string]$Output, [string[]]$Tokens, [int]$Version, [bool]$CheckVersion)
  $refused = ($Output -match 'Schema verification failed')
  $missing = @($Tokens | Where-Object { $Output -notmatch [regex]::Escape($_) })
  $named   = ($missing.Count -eq 0)
  $tokens  = ($Tokens -join "' + '")
  $versionOk = $true
  if ($CheckVersion) { $versionOk = ($Version -eq 0) }

  if ($refused -and $named -and $versionOk) {
    if ($CheckVersion) {
      Write-Host "  caught: stamp withheld, version still 0, reason mentions '$tokens'" -ForegroundColor Green
    } else {
      Write-Host "  caught: stamp withheld, reason mentions '$tokens'" -ForegroundColor Green
    }
    return $true
  }

  Write-Host ("  NOT CAUGHT: refused={0} missing from the refusal: '{1}'{2}" -f `
    $refused, ($missing -join "', '"), $(if ($CheckVersion) { " version=$Version" } else { '' })) -ForegroundColor Red
  ($Output -split "`n" | Select-String -Pattern 'WARNING|ERROR|NOTICE' | Select-Object -First 12) |
    ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
  Add-Failure "$Id (hole not caught)"
  return $false
}

# ---------------------------------------------------------------------------
# -Tier full: the original flow, in two psql sessions per control instead of
# seven or eight.
#
# Session 1 sets the stamp to 0, applies the hole with ON_ERROR_STOP on, runs
# the verification with it off, and emits the stamp. If the hole fails, psql
# exits on the spot and the @@NC|stamp1 line is simply absent - which is how
# this detects it, rather than by scanning for the string ERROR:. The two are
# equivalent (ON_ERROR_STOP is what makes psql stop, and psql's own ERROR:
# prefix is what the original matched) and the absent line does not depend on
# the order the merged streams arrive in.
#
# Session 2 applies the repair files, verifies again, and applies the cleanup
# files. ON_ERROR_STOP is off across the repairs so that a repair which fails
# is caught by the verification, exactly as in the original, where the failing
# psql's exit code was discarded with | Out-Null.
# ---------------------------------------------------------------------------
function Invoke-ControlFull {
  param($Control)

  $script:Ran = $script:Ran + 1
  Write-Host "`n--- $($Control.Id)  $($Control.What)" -ForegroundColor Cyan

  $s1 = $PREAMBLE + "UPDATE schema_version SET version = 0 WHERE id = 1;`n" +
        "\set ON_ERROR_STOP on`n" +
        ("\i " + $Control.Hole + "`n") +
        "\set ON_ERROR_STOP off`n" +
        "\i /blueplm/tools/verify-schema.sql`n" +
        (Emit 'stamp1' 'SELECT version FROM schema_version WHERE id = 1')

  $out1 = Invoke-PsqlSession -Label "$($Control.Id) hole + verify" -Script $s1
  $script:Verifies = $script:Verifies + 1

  $stamp1Raw = Get-Emitted $out1 'stamp1'
  if ($stamp1Raw -eq '') {
    Write-Host "  hole did not apply:" -ForegroundColor Red
    Write-Host $out1
    Add-Failure "$($Control.Id) (hole failed to apply)"
    return
  }

  [void](Test-Caught -Id $Control.Id -What $Control.What -Output $out1 `
                     -Tokens $Control.Tokens -Version (ConvertTo-StampedVersion $stamp1Raw) -CheckVersion $true)

  $s2 = $PREAMBLE
  foreach ($f in $Control.Repair) { $s2 += ("\i " + $f + "`n") }
  $s2 += "\i /blueplm/tools/verify-schema.sql`n"
  $s2 += (Emit 'stamp2' 'SELECT version FROM schema_version WHERE id = 1')
  foreach ($f in $Control.Cleanup) { $s2 += ("\i " + $f + "`n") }

  $out2 = Invoke-PsqlSession -Label "$($Control.Id) repair + verify" -Script $s2
  $script:Verifies = $script:Verifies + 1

  $v2 = ConvertTo-StampedVersion (Get-Emitted $out2 'stamp2')
  if ($v2 -eq $RELEASE) {
    Write-Host "  repaired: stamped again at $v2" -ForegroundColor Green
  } else {
    Write-Host "  REPAIR FAILED: version is $v2, expected $RELEASE" -ForegroundColor Red
    ($out2 -split "`n" | Select-String -Pattern 'WARNING|ERROR' | Select-Object -First 12) |
      ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    Add-Failure "$($Control.Id) (repair failed)"
  }
}

# ---------------------------------------------------------------------------
# -Tier standard: one transaction per control, rolled back.
#
# WHY THE ROLLBACK IS A FAITHFUL REPAIR AND THE MODULE RE-APPLY IS NOT REPLACED
#
# Every hole file is data-definition or data-manipulation and none of them
# contains BEGIN, COMMIT or ROLLBACK (checked: the only `BEGIN`s in harness/sql
# are the ones opening plpgsql DO blocks). PostgreSQL rolls back DDL, so
# ROLLBACK restores the catalogue to the state it had before the hole, byte for
# byte - a stronger guarantee than re-running a module file, which restores the
# object the module owns and says nothing about anything the hole touched
# incidentally.
#
# What it does NOT do is assert that re-running the named module file repairs
# the hole. That assertion is the point of NC1, NC2, NC6, NC12, NC16, NC17,
# NC18 and NC19 - a reported condition the printed remedy cannot clear is the
# v90 defect this project spent two releases removing - so this tier prints,
# per control, that the assertion was not made. Use -Tier full for a release.
#
# The stamp is read from the refusal rather than from schema_version, because
# tools/verify-schema.sql raises at the end and an aborted transaction cannot be
# queried. That equivalence is not assumed: see the STAMP WITHHELD control,
# which is the one place it is established, with a fixture built to break it.
# ---------------------------------------------------------------------------
function Invoke-ControlRollback {
  param($Control)

  $script:Ran = $script:Ran + 1
  Write-Host "`n--- $($Control.Id)  $($Control.What)" -ForegroundColor Cyan

  $s = $PREAMBLE + "BEGIN;`n" +
       "UPDATE schema_version SET version = 0 WHERE id = 1;`n" +
       "\set ON_ERROR_STOP on`n" +
       ("\i " + $Control.Hole + "`n") +
       (Emit 'applied' "SELECT 'yes'") +
       "\set ON_ERROR_STOP off`n" +
       "\i /blueplm/tools/verify-schema.sql`n" +
       "ROLLBACK;`n" +
       (Emit 'signature' 'SELECT harness_fast.catalog_signature()')

  $out = Invoke-PsqlSession -Label "$($Control.Id) hole + verify (rolled back)" -Script $s
  $script:Verifies = $script:Verifies + 1

  if ((Get-Emitted $out 'applied') -ne 'yes') {
    Write-Host "  hole did not apply:" -ForegroundColor Red
    Write-Host $out
    Add-Failure "$($Control.Id) (hole failed to apply)"
    return
  }

  [void](Test-Caught -Id $Control.Id -What $Control.What -Output $out `
                     -Tokens $Control.Tokens -Version 0 -CheckVersion $false)

  $sig = Get-Emitted $out 'signature'
  if ($sig -ne $baselineSignature) {
    Write-Host ("  ROLLBACK DID NOT RESTORE: catalogue signature is {0}, baseline was {1}. Everything after this control is running against a database nobody has verified." `
      -f $sig, $baselineSignature) -ForegroundColor Red
    Add-Failure "$($Control.Id) (rollback left the database changed)"
  }

  if ($Control.RepairIsRemedy) {
    Write-Host ("  not asserted in this tier: that re-running {0} repairs it. -Tier full asserts it." `
      -f ($Control.Repair -join ', ')) -ForegroundColor DarkGray
  }
}

# ---------------------------------------------------------------------------
# -Tier smoke: every hole at once, one verification, one rollback.
#
# The risk this takes is masking - one hole changing what the verifier says
# about another - and the defence is that a token set which cannot be found is
# reported by control id rather than folded into a count, so masking presents as
# a named failure and not as a quiet pass. It is still not a release signal, and
# the summary says so on every run.
# ---------------------------------------------------------------------------
function Invoke-SmokeBatch {
  param($Batch)

  Write-Host "`n--- SMOKE: $($Batch.Count) holes, one verification, one rollback" -ForegroundColor Cyan

  $s = $PREAMBLE + "BEGIN;`n" +
       "UPDATE schema_version SET version = 0 WHERE id = 1;`n" +
       "\set ON_ERROR_STOP on`n"
  foreach ($c in $Batch) {
    $s += ("\i " + $c.Hole + "`n")
    $s += (Emit ('applied|' + $c.Id) "SELECT 'yes'")
  }
  $s += "\set ON_ERROR_STOP off`n" +
        "\i /blueplm/tools/verify-schema.sql`n" +
        "ROLLBACK;`n" +
        (Emit 'signature' 'SELECT harness_fast.catalog_signature()')

  $out = Invoke-PsqlSession -Label 'smoke batch' -Script $s
  $script:Verifies = $script:Verifies + 1

  $refused = ($out -match 'Schema verification failed')
  if (-not $refused) {
    Write-Host "  NOT CAUGHT: the verifier stamped a database carrying every hole at once." -ForegroundColor Red
    Add-Failure 'smoke (nothing was caught)'
  }

  foreach ($c in $Batch) {
    $script:Ran = $script:Ran + 1
    if ((Get-Emitted $out ('applied|' + $c.Id)) -ne 'yes') {
      Write-Host ("  [FAILED]  {0}  hole did not apply - every hole after it was skipped" -f $c.Id.PadRight(5)) -ForegroundColor Red
      Add-Failure "$($c.Id) (hole failed to apply)"
      continue
    }
    $missing = @($c.Tokens | Where-Object { $out -notmatch [regex]::Escape($_) })
    if ($refused -and $missing.Count -eq 0) {
      Write-Host ("  [ok]      {0}  {1}" -f $c.Id.PadRight(5), $c.What) -ForegroundColor Green
    } else {
      Write-Host ("  [FAILED]  {0}  missing from the refusal: '{1}'" -f $c.Id.PadRight(5), ($missing -join "', '")) -ForegroundColor Red
      Write-Host  "            A hole that is caught alone and not in company is a hole another hole masked. Re-run with -Tier standard -Only $($c.Id)." -ForegroundColor DarkGray
      Add-Failure "$($c.Id) (not caught in the batch)"
    }
  }

  $sig = Get-Emitted $out 'signature'
  if ($sig -ne $baselineSignature) {
    Write-Host ("  ROLLBACK DID NOT RESTORE: catalogue signature is {0}, baseline was {1}." -f $sig, $baselineSignature) -ForegroundColor Red
    Add-Failure 'smoke (rollback left the database changed)'
  }
}

# ---------------------------------------------------------------------------
# THE STAMP WITHHELD CONTROL
#
# negative-controls.ps1 asserts eighteen times that schema_version still holds 0
# after a refusal. That is eighteen copies of one property of
# verify_and_stamp_schema(): it writes the stamp only on success. The rollback
# tiers cannot read schema_version after the refusal - the transaction is
# aborted - so the property is asserted once, here, and asserted properly:
# against a database with a hole in it AND against one without, so that "the
# version did not move" is shown to be a consequence of the refusal rather than
# of the version never moving at all.
#
# Both halves have to hold. The first alone would pass against a
# verify_and_stamp_schema() that never wrote anything.
# ---------------------------------------------------------------------------
function Invoke-StampWithheldControl {
  Write-Host "`n--- STAMP  verify_and_stamp_schema() writes the version on success and not otherwise" -ForegroundColor Cyan
  $script:Ran = $script:Ran + 1

  $out = Invoke-PsqlSession -Label 'stamp-withheld control' -Script ($PREAMBLE + @'
-- Half one: a hole in place. stamped must be false and the row must not move.
BEGIN;
UPDATE schema_version SET version = 0 WHERE id = 1;
\set ON_ERROR_STOP on
\i /sql/nc4-born-open.sql
\set ON_ERROR_STOP off
'@ + (Emit 'holed_stamped' "SELECT (verify_and_stamp_schema()->>'stamped')") `
   + (Emit 'holed_version' 'SELECT version FROM schema_version WHERE id = 1') + @'
ROLLBACK;

-- Half two: the same call on the clean database. stamped must be true and the
-- row must move, or half one proves nothing.
BEGIN;
UPDATE schema_version SET version = 0 WHERE id = 1;
'@ + (Emit 'clean_stamped' "SELECT (verify_and_stamp_schema()->>'stamped')") `
   + (Emit 'clean_version' 'SELECT version FROM schema_version WHERE id = 1') + @'
ROLLBACK;
'@)
  $script:Verifies = $script:Verifies + 2

  $holedStamped = Get-Emitted $out 'holed_stamped'
  $holedVersion = ConvertTo-StampedVersion (Get-Emitted $out 'holed_version')
  $cleanStamped = Get-Emitted $out 'clean_stamped'
  $cleanVersion = ConvertTo-StampedVersion (Get-Emitted $out 'clean_version')

  if ($holedStamped -eq 'false' -and $holedVersion -eq 0 -and
      $cleanStamped -eq 'true'  -and $cleanVersion -eq $RELEASE) {
    Write-Host ("  correct: with a hole it returned stamped=false and left the version at 0; without one it returned stamped=true and wrote {0}." -f $RELEASE) -ForegroundColor Green
  } else {
    Write-Host ("  WRONG: holed stamped={0} version={1}; clean stamped={2} version={3} (expected false/0 and true/{4})" `
      -f $holedStamped, $holedVersion, $cleanStamped, $cleanVersion, $RELEASE) -ForegroundColor Red
    Add-Failure 'STAMP (verify_and_stamp_schema does not write the version exactly when it says it did)'
  }
}

# ---------------------------------------------------------------------------
# NC7: the other direction. The verifier must report loudly and stamp anyway,
# because the object is one no project role can revoke, and a verifier that
# withholds the stamp for a condition the operator cannot clear is the v90
# defect whatever it is protecting.
#
# Same assertions as the original with one correction: the original tests the
# hole output with `-match 'ERROR'` - case-insensitive, no colon - where every
# other control in the file uses `-cmatch 'ERROR:'`, so a NOTICE containing the
# word "error" would have been reported as a hole that failed to apply. That
# branch has never run, which is why nobody noticed. Detection here is the
# absent-emission test used everywhere else and does not read the text at all.
# ---------------------------------------------------------------------------
function Invoke-NC7 {
  Write-Host "`n--- NC7  a function in public owned by supabase_admin, which postgres cannot revoke" -ForegroundColor Cyan
  $script:Ran = $script:Ran + 1

  $applied = Invoke-PsqlSession -AsRole 'supabase_admin' -Label 'NC7 hole (supabase_admin)' -Script ($PREAMBLE + @'
\set ON_ERROR_STOP on
\i /sql/nc7-unrevokable.sql
'@ + (Emit 'applied' "SELECT 'yes'"))

  if ((Get-Emitted $applied 'applied') -ne 'yes') {
    Write-Host "  hole did not apply:" -ForegroundColor Red
    Write-Host $applied
    Add-Failure 'NC7 (hole failed to apply)'
    return
  }

  $out = Invoke-PsqlSession -Label 'NC7 revoke attempt + verify' -Script ($PREAMBLE + @'
UPDATE schema_version SET version = 0 WHERE id = 1;
REVOKE EXECUTE ON FUNCTION public.nc_unrevokable(TEXT) FROM anon, PUBLIC;
'@ + (Emit 'still_there' "SELECT has_function_privilege('anon','public.nc_unrevokable(text)','EXECUTE')") + @'
\i /blueplm/tools/verify-schema.sql
'@ + (Emit 'stamp' 'SELECT version FROM schema_version WHERE id = 1'))
  $script:Verifies = $script:Verifies + 1

  $stillThere = ((Get-Emitted $out 'still_there') -eq 'true')
  $version    = ConvertTo-StampedVersion (Get-Emitted $out 'stamp')
  $reported   = ($out -match 'nc_unrevokable')
  $advisory   = ($out -match 'advisory')
  $refused    = ($out -match 'Schema verification failed')

  if ($stillThere -and $reported -and $advisory -and -not $refused -and $version -eq $RELEASE) {
    Write-Host "  correct: postgres could not revoke it, it is reported by name as advisory, and the stamp was still granted" -ForegroundColor Green
  } else {
    Write-Host ("  WRONG: anon still has it={0} reported={1} advisory={2} stamp withheld={3} version={4}" -f `
      $stillThere, $reported, $advisory, $refused, $version) -ForegroundColor Red
    if (-not $stillThere) { Write-Host "    postgres was able to revoke it, so this is not the condition being tested" -ForegroundColor DarkGray }
    ($out -split "`n" | Select-String -Pattern 'nc_unrevokable|Schema NOT stamped' | Select-Object -First 6) |
      ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    Add-Failure 'NC7 (unrevokable object graded wrongly)'
  }

  Invoke-PsqlSession -AsRole 'supabase_admin' -Label 'NC7 cleanup' -Script ($PREAMBLE + "\i /sql/nc7-drop.sql`n") | Out-Null
}

# ---------------------------------------------------------------------------
# POSTURE: the things no HTTP request can see.
#
# Wrapped in a transaction that is always rolled back, which the original does
# not do. That is a fix rather than an optimisation. posture-checks.sql section
# 2 applies a real workflow transition to aaaaaaaa-3333-...-002 and leaves it
# applied, so a second run finds the file in the destination state, the
# legitimate move is refused, and the block raises OVER-BOUND: the file is not
# re-runnable against one database, and negative-controls.ps1 therefore only
# passes immediately after a reset. attack.ps1 works around exactly this for its
# own C8 control by trying the transition and then the reverse one. Rolling back
# makes the check idempotent and changes nothing it asserts, because every
# assertion is made before the rollback.
# ---------------------------------------------------------------------------
function Invoke-Posture {
  Write-Host "`n--- POSTURE CHECKS" -ForegroundColor Cyan
  $script:Ran = $script:Ran + 1

  $posture = Invoke-PsqlSession -Label 'posture checks (rolled back)' -Script ($PREAMBLE + @'
BEGIN;
\i /sql/posture-checks.sql
ROLLBACK;
'@ + (Emit 'signature' 'SELECT harness_fast.catalog_signature()'))

  if ($posture -match 'POSTURE CHECKS PASSED') {
    $flat = ($posture -replace '\s+', ' ')
    [regex]::Matches($flat, 'PASS - [^.]+\.') | ForEach-Object { Write-Host ("  " + $_.Value) -ForegroundColor Green }
  } else {
    Write-Host $posture -ForegroundColor Red
    Add-Failure 'posture checks'
  }

  $sig = Get-Emitted $posture 'signature'
  if ($sig -ne $baselineSignature) {
    Write-Host ("  the posture checks changed the catalogue and the rollback did not put it back: {0} vs baseline {1}" -f $sig, $baselineSignature) -ForegroundColor Red
    Add-Failure 'posture checks (left the database changed)'
  }
}

# ---------------------------------------------------------------------------
# CENSUS: the class of hole NC18 and NC19 are two instances of.
#
# withdrawn_execute_manifest() is five function names, hand-maintained, and
# core.sql says so in as many words: "the cost of leaving one out is what
# release 95 nearly shipped". Nothing computes the list. A SECURITY DEFINER
# function in public that takes no p_org_id, that `authenticated` may execute,
# and that nobody put on that list is checked by nothing at all -
# check_anon_reach() asks about anon, check_org_gates() only probes functions
# taking a p_org_id, and check_withdrawn_execute() only looks at the five.
#
# This does not withhold anything on its own account: most of those functions
# are the application's own RPCs and are supposed to be callable. What it does
# is print the census and fail when it GROWS, so that the next
# cleanup_extension_http_logs is a line in a diff rather than something found by
# a control somebody wrote two releases later.
# ---------------------------------------------------------------------------
function Invoke-EndpointCensus {
  Write-Host "`n--- CENSUS  SECURITY DEFINER routines authenticated can reach that no check probes" -ForegroundColor Cyan
  $script:Ran = $script:Ran + 1

  $out = Invoke-PsqlSession -Label 'endpoint census' -Script ($PREAMBLE + "\i /sql/fast/nc-endpoint-census.sql`n")

  $count = Get-Emitted $out 'census_unprobed'
  $baselineFile = Join-Path $PSScriptRoot 'sql\fast\census-baseline.txt'

  if ($count -notmatch '^\d+$') {
    Write-Host "  the census did not answer:" -ForegroundColor Red
    Write-Host $out
    Add-Failure 'CENSUS (did not run)'
    return
  }

  $names = @()
  foreach ($m in [regex]::Matches($out, '@@NC\|census_row\|(.*)')) { $names += $m.Groups[1].Value.Trim() }
  $names = @($names | Sort-Object)

  if (-not (Test-Path $baselineFile)) {
    # A missing baseline is a failure, not a first run.
    #
    # This branch used to write the file, print an advisory and return without
    # calling Add-Failure, which made the census the one check in this file that
    # could not fail: the baseline is untracked and deliberately absent, so the
    # branch ran on every clean checkout. Worse than unfalsifiable - it recorded
    # whatever was reachable at that moment as "known", so the routine the check
    # exists to surface became the content of its own baseline. An audit of
    # release 95 found notify_overdue_reviews() this way: SECURITY DEFINER, no
    # organization argument, executable by authenticated, and it would have been
    # written into census-baseline.txt as expected on the first run.
    #
    # The file is still written, because reading it is how the operator decides
    # what belongs there. It is written as a PROPOSAL that has to be audited and
    # committed before the check means anything, and the run fails until it is.
    Set-Content -Path $baselineFile -Value ($names -join "`n") -Encoding UTF8
    Write-Host ("  [FAILED]  no committed census baseline, so this check had nothing to compare {0} routine(s) against." -f $count) -ForegroundColor Red
    Write-Host  "            A proposal has been written to sql/fast/census-baseline.txt. It is NOT a baseline yet: it is" -ForegroundColor DarkGray
    Write-Host  "            whatever this database happens to expose. Read every line, withdraw the ones that should not be" -ForegroundColor DarkGray
    Write-Host  "            reachable, and commit the rest. Until it is committed this check cannot detect anything." -ForegroundColor DarkGray
    $names | ForEach-Object { Write-Host ("              " + $_) -ForegroundColor DarkGray }
    Add-Failure 'CENSUS (no committed baseline to compare against)'
    return
  }

  $known = @(Get-Content $baselineFile | Where-Object { $_.Trim() -ne '' } | ForEach-Object { $_.Trim() })
  $new   = @($names | Where-Object { $known -notcontains $_ })
  if ($new.Count -eq 0) {
    Write-Host ("  [ok]      {0} routine(s), all of them already on the recorded census" -f $count) -ForegroundColor Green
  } else {
    Write-Host ("  [FAILED]  {0} SECURITY DEFINER routine(s) became reachable by authenticated with nothing probing them:" -f $new.Count) -ForegroundColor Red
    $new | ForEach-Object { Write-Host ("            " + $_) -ForegroundColor Red }
    Write-Host  "            Either gate it on an organization argument, or add it to withdrawn_execute_manifest() and REVOKE it, or add it to sql/fast/census-baseline.txt with a reason in the commit message." -ForegroundColor DarkGray
    Add-Failure ("CENSUS (" + $new.Count + " newly unprobed routine(s))")
  }
}

# ---------------------------------------------------------------------------
# -SelfTest: prove that this script reports failure when a control fails.
#
# Everything above is a verifier, and a verifier whose failure path is dead code
# passes everything. Each case below breaks one control on purpose and requires
# the machinery to notice; the case passes when the control FAILS.
# ---------------------------------------------------------------------------
function Invoke-SelfTest {
  Write-Host "`n=== SELF-TEST: every failure path below is executed on purpose ===" -ForegroundColor Yellow
  # Script scope, not local. `$problems += ...` inside the nested function would
  # read the enclosing variable and then write a fresh copy into the nested
  # function's own scope, so every case would report [FAILED] and the run would
  # still end with SELF-TEST OK. A self-test that cannot fail is the exact defect
  # this mode exists to look for, so it is worth not shipping it here.
  $script:SelfTestProblems = @()

  function Test-Case {
    param([string]$Name, [scriptblock]$Body, [string]$ExpectFailureLike)
    $script:Failures = @()
    $before = $script:Ran
    & $Body
    $got = ($script:Failures -join '; ')
    $script:Ran = $before
    if ($got -match [regex]::Escape($ExpectFailureLike)) {
      Write-Host ("  [ok]      {0} -> reported: {1}" -f $Name.PadRight(46), $got) -ForegroundColor Green
    } else {
      Write-Host ("  [FAILED]  {0} -> expected a failure mentioning '{1}', got '{2}'" -f $Name, $ExpectFailureLike, $got) -ForegroundColor Red
      $script:SelfTestProblems += $Name
    }
    $script:Failures = @()
  }

  # A hole that does nothing. The verifier has nothing to catch, so the control
  # must report NOT CAUGHT. Without this case, "every control passed" would also
  # be what a Test-Caught that always returned true printed.
  Test-Case -Name 'a hole that opens nothing is reported NOT CAUGHT' -ExpectFailureLike 'hole not caught' -Body {
    Invoke-ControlRollback @{ Id='ST1'; What='self-test: a no-op hole'
      Hole='/sql/fast/selftest-noop.sql'; Tokens=@('anon-reachable')
      Repair=@(); Cleanup=@(); RepairIsRemedy=$false }
  }

  # A real hole with the wrong expected token. The verifier refuses, but for a
  # reason the control did not name - which is the mistake the "and name the
  # right reason" half of every control exists to prevent.
  Test-Case -Name 'a refusal for the wrong reason is not a catch' -ExpectFailureLike 'hole not caught' -Body {
    Invoke-ControlRollback @{ Id='ST2'; What='self-test: right hole, wrong token'
      Hole='/sql/nc4-born-open.sql'; Tokens=@('this-token-appears-in-no-refusal')
      Repair=@(); Cleanup=@(); RepairIsRemedy=$false }
  }

  # A hole file that is not there. The original scans the output for ERROR: to
  # decide this; the fast runner decides it from an emission that never arrived.
  Test-Case -Name 'a hole file that will not apply is reported as such' -ExpectFailureLike 'hole failed to apply' -Body {
    Invoke-ControlRollback @{ Id='ST3'; What='self-test: missing hole file'
      Hole='/sql/fast/selftest-does-not-exist.sql'; Tokens=@('anon-reachable')
      Repair=@(); Cleanup=@(); RepairIsRemedy=$false }
  }

  # A repair that repairs nothing, in the tier that checks repairs.
  Test-Case -Name 'a repair that does not repair is reported' -ExpectFailureLike 'repair failed' -Body {
    Invoke-ControlFull @{ Id='ST4'; What='self-test: no-op repair'
      Hole='/sql/nc4-born-open.sql'; Tokens=@('anon-reachable')
      Repair=@('/sql/fast/selftest-noop.sql'); Cleanup=@('/sql/nc4-drop.sql'); RepairIsRemedy=$false }
  }

  # The signature has to notice a change, or every rollback claim in this file
  # is unfalsifiable. This leaves an object behind deliberately and requires the
  # comparison to catch it - then removes it.
  Test-Case -Name 'the catalogue signature notices an object left behind' -ExpectFailureLike 'rollback left the database changed' -Body {
    Invoke-ControlRollback @{ Id='ST5'; What='self-test: a hole that commits itself'
      Hole='/sql/fast/selftest-commits.sql'; Tokens=@('anon-reachable')
      Repair=@(); Cleanup=@(); RepairIsRemedy=$false }
  }
  Invoke-PsqlSession -Label 'self-test cleanup' -Script ($PREAMBLE + "\i /sql/fast/selftest-commits-drop.sql`n") | Out-Null

  Write-Host ""
  if ($script:SelfTestProblems.Count -gt 0) {
    Write-Host ("SELF-TEST FAILED: {0}. These controls cannot be shown to fail, so their passes mean nothing." -f ($script:SelfTestProblems -join '; ')) -ForegroundColor Red
    exit 1
  }
  Write-Host "SELF-TEST OK: every failure path above was executed and reported." -ForegroundColor Green
  exit 0
}

if ($SelfTest) { Invoke-SelfTest }

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
$selected = @($Controls | Where-Object { Test-Wanted $_.Id })

if ($Tier -eq 'smoke') {
  # NC7 needs a different login role, so it cannot join a batch that has to be
  # one transaction. It is named as skipped rather than silently dropped.
  if ($selected.Count -gt 0) { Invoke-SmokeBatch -Batch $selected }
  if (Test-Wanted 'NC7') { Write-Host "`n--- NC7  skipped in the smoke tier: its hole is applied as supabase_admin, which cannot share the batch's transaction." -ForegroundColor DarkGray }
} else {
  foreach ($c in $selected) {
    if ($Tier -eq 'full') { Invoke-ControlFull -Control $c } else { Invoke-ControlRollback -Control $c }
  }
  if (Test-Wanted 'NC7') { Invoke-NC7 }
}

# STAMP and POSTURE each cost a verification run or a workflow transition, which
# is most of a smoke tier's whole budget. They are off by default there and on
# everywhere else - and naming one in -Only turns it on regardless, so the
# cheap tier is a default rather than a restriction.
function Test-WantedExtra {
  param([string]$Id)
  if ($Only.Count -gt 0) { return ($Only -contains $Id) }
  return ($Tier -ne 'smoke')
}

if (Test-WantedExtra 'STAMP')   { Invoke-StampWithheldControl }
# The census is in every tier. It is two catalogue queries, it is the only thing
# in the suite that looks for holes nobody has written a control for yet, and a
# tier that runs on every commit is exactly where a newly exposed routine should
# surface.
if (Test-Wanted 'CENSUS')       { Invoke-EndpointCensus }
if (Test-WantedExtra 'POSTURE') { Invoke-Posture }

# The database must still verify clean at the end, or one of the controls left
# damage behind and every later run starts from a lie. Asked of the catalogue
# as well as of the verifier, because a signature that has drifted while the
# verifier still stamps is a hole in the verifier and worth knowing about.
#
# Skipped in the smoke tier, where nothing was committed in the first place and
# the signature taken after the single rollback already establishes that the
# catalogue came back. Running the verification again there would double the
# tier's cost to re-derive something it has already shown.
if ($Tier -ne 'smoke') {
  $final = Invoke-PsqlSession -Label 'final verify + signature' -Script ($PREAMBLE + @'
\i /blueplm/tools/verify-schema.sql
'@ + (Emit 'stamp' 'SELECT version FROM schema_version WHERE id = 1') `
     + (Emit 'signature' 'SELECT harness_fast.catalog_signature()'))
  $script:Verifies = $script:Verifies + 1

  if ((ConvertTo-StampedVersion (Get-Emitted $final 'stamp')) -ne $RELEASE) {
    Write-Host "`nFAIL: the database no longer verifies clean after the controls ran." -ForegroundColor Red
    ($final -split "`n" | Select-String -Pattern 'WARNING|ERROR' | Select-Object -First 20) |
      ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    Add-Failure 'left the database dirty'
  }
  $finalSignature = Get-Emitted $final 'signature'
  if ($finalSignature -ne $baselineSignature) {
    Write-Host ("`nFAIL: the catalogue is not what it was when the run started - {0} now, {1} before. The verifier stamped it anyway, which means the difference is something no check looks at." `
      -f $finalSignature, $baselineSignature) -ForegroundColor Red
    Add-Failure 'left the catalogue changed'
  }
}

if ($script:Ran -eq 0) {
  Write-Host "`nFAIL: no control executed. A suite that runs nothing cannot report success." -ForegroundColor Red
  Add-Failure 'no control executed'
}

Write-Host ""
Write-Host ("{0} control(s) executed, {1} verification run(s), {2:N0}s in psql." `
  -f $script:Ran, $script:Verifies, $script:Elapsed) -ForegroundColor DarkGray

if ($Tier -ne 'full') {
  Write-Host ("-Tier {0} does not assert that the named module file repairs each hole, and reads the withheld stamp from the refusal rather than from schema_version. Sign a release off on -Tier full." `
    -f $Tier) -ForegroundColor Yellow
}

if ($script:Failures.Count -gt 0) {
  Write-Host ("FAIL: {0}" -f ($script:Failures -join '; ')) -ForegroundColor Red
  exit 1
}
Write-Host ("OK: {0} controls executed at release {1}. Every hole was caught by the verifier, the one nobody can fix was reported without blocking, and the database still verifies clean." `
  -f $script:Ran, $RELEASE) -ForegroundColor Green
exit 0
