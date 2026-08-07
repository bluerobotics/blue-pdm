# Security harness

A throwaway Supabase-shaped Postgres plus PostgREST, for testing the database's
authorization behaviour the way a client actually meets it.

It exists because two consecutive releases shipped security fixes that their own
verification passed and that did not work. Neither failure was in the SQL. Both
were in the environment the SQL was checked in:

- The first was verified in a stock Postgres container, which does not run
  Supabase's bootstrap. That bootstrap issues
  `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO anon`, an explicit
  grant that `REVOKE ... FROM PUBLIC` does not touch. The fix was inert on the
  real platform and the verifier printed a clean all-clear.
- The second ran `postgres` as a superuser. Postgres 16 and later silently
  refuse `ALTER ROLE postgres NOSUPERUSER`, so Supabase's demotion never
  happened, and every privilege check answered yes for a reason unrelated to
  what it was asking.

So the environment is asserted rather than assumed, and the container refuses to
finish starting if the assertions do not hold — see `initdb/90-assert-harness.sql`.

## What is reproduced

`supabase_admin` is the bootstrap superuser, as on Supabase, because a container
whose bootstrap role is `postgres` cannot be demoted at all. Then
`initdb/10-supabase-bootstrap.sh` runs Supabase's own
`00000000000000-initial-schema.sql` and the role migrations, each as the role
that runs it there, which produces:

- `postgres` with `rolsuper = f`, `BYPASSRLS`, and not a member of `supabase_admin`
- `anon`, `authenticated`, `service_role`, `authenticator` with Supabase's grants
- **both** `pg_default_acl` rows for functions in `public` — one granted by
  `postgres`, one by `supabase_admin`. The second is the one no project role can
  alter, and the one the previous release's verifier treated as fatal.

Every run prints the role table and both default-ACL rows, so the demotion is
read out loud rather than trusted.

## Running it

```powershell
.\reset.ps1                                    # rebuild, install, seed, start PostgREST
.\tooling-controls.ps1                         # do the verifiers catch what they claim to?
.\negative-controls.ps1                        # reintroduce each hole, require the verifier to catch it
.\attack.ps1 -Expect fixed                     # the attack suite
.\policy-controls.ps1                          # revert each policy fix, require the hole to reopen
.\upgrade.ps1                                  # the other lane: attack the previous release, then upgrade over it
```

`negative-controls.ps1` takes its expected release number from
`schema_release_version()` rather than from a literal, so it cannot go stale
when the schema moves. Pass `-ExpectRelease 95` to assert the number as well.

`reset.ps1 -CoreOnly` and `reset.ps1 -Modules 10-source-files,15-inspection`
cover the partial-install cases.

Tear down with `docker compose down -v`.

### The other half of a before/after

`RELEASE_DIR` chooses which copy of `supabase/` is installed. It defaults to the
working tree; point it at a worktree to run the attacks against an older
release:

```powershell
git worktree add ../../blueplm-v90 <commit>
$env:RELEASE_DIR = '../../blueplm-v90/supabase'
.\reset.ps1
.\attack.ps1 -Expect vulnerable
Remove-Item Env:\RELEASE_DIR
```

Both halves therefore exist at once and either can be reproduced at any time.
Stashing or checking the old files out in place has to be undone before the
second half can run, and a comparison whose two halves cannot both exist is one
nobody else can repeat — which is how `evidence/01-attacks-before-fix.txt` came
to be a file no committed script could regenerate.

### The two lanes

Everything above is the **fresh lane**: a release installed into an empty
database, attacked, verified. Every release up to and including v92 was checked
that way and only that way — and a fresh database has no history for a fix to
fail to undo, so no release had ever been asked whether it cleans up after the
holes it closes. Applied over a database that had run v90 and been attacked,
v92 left a cross-tenant share link answering `is_valid: true` to `anon` and
still spending downloads, surviving *because* of the fix, with
`verify_and_stamp_schema()` reporting the schema clean.

`upgrade.ps1` is the **upgrade lane**, which is the owner's actual path:

```powershell
git worktree add ../../blueplm-v90 <commit>
.\upgrade.ps1 -Baseline ../../blueplm-v90/supabase   # the default
```

It installs the baseline, runs the attack suite so the database carries real
damage, prints the residue that damage left, applies the release under test
**in place with no teardown**, prints the residue again and what the
remediations acted on, verifies, re-attacks and runs the posture checks. Both
copies of `supabase/` are mounted at once: `BASELINE_DIR` at `/baseline` and
`RELEASE_DIR` at `/blueplm`, so `install.ps1 -Root /baseline` and
`install.ps1 -Root /blueplm` are the same script pointed at two releases.

A release has to pass both lanes.

`sql/residue-report.sql` is the standalone version of what the lane prints: the
cross-tenant share links, workflow history and workflow assignments a closed
hole leaves behind. It is read-only and safe to run against a copy of a real
database.

## Four things the scripts refuse to do

**Score a connection failure as a refusal.** `attack.ps1` once reported "every
attack was refused" with the PostgREST container stopped. It now checks the API
answers and the seed is present before it starts, and any request that does not
reach the server voids the run.

**Report a pass over a broken application.** Every attack failing is also what
you get from a schema that was simply revoked into uselessness. The positive
controls check the things that must keep working — a member reading their own
organization's parts through `parts_with_pricing`, minting and redeeming a share
link for their own file, running a legitimate workflow transition, the sign-in
screen reading auth providers with the anon key — and a broken one voids the run
too.

**Score a refusal that never reached the code under test.** The anon token used
to carry `"sub": ""`. `auth.uid()` casts that claim to `uuid`, `''::uuid` raises,
PostgREST returns 400, and the script counted it as a refusal — so every anon
attack that got as far as `auth.uid()` was passing for the wrong reason, inside
the harness built to prevent exactly that. A real publishable key carries no
`sub` at all and yields `NULL`, which is the case the gates are written against,
and that is what `New-Jwt` now emits.

**Report an attack as refused because its setup failed.** Four of the share-link
attacks used to hang off the token minted by `F3a`. When `F3a` was fixed and
minted nothing, all four printed "refused — no token was minted", and the suite
reported zero breaches over three findings it had not tested. They now mint
their own links legitimately, as a member sharing her own file, which works in
every state of the code.

## The tenants

`sql/seed.sql` creates two organizations and four accounts. The one that matters
is `mallory@nowhere.test`, whose `users.org_id` is `NULL`: that is the account
the NULL-unsafe membership tests admit, and testing as `postgres` with
`auth.uid()` null does not reach it. There is also a `ghost` organization whose
auth providers are exactly what the function returns for an organization that
does not exist, which is what makes the enumeration test fair.

## The controls

`negative-controls.ps1` reintroduces one hole at a time and requires the
verifier to withhold the stamp *and* to name the right reason, then repairs it
and requires the stamp back.

Three of them are not shaped like the others.

- **NC6** repairs by running the remedy the verifier prints, not by removing the
  procedure. That is the control: v90 withheld the stamp for a condition the
  operator could not clear, and v91 relocated it to procedures rather than
  fixing it. The stamp has to come back with the procedure still in `public`.
- **NC7** requires the opposite verdict. A function in `public` owned by
  `supabase_admin` cannot be revoked by `postgres` — the control checks that
  first, so "advisory" is a fact rather than a claim — and verification must
  report it by name and stamp anyway. Silence would hide a live anon entry
  point; refusal would brick the project.
- **NC10** and **NC11** repair by *fixing* the function rather than dropping it,
  so a check that reacted to the object's existence rather than to its gate
  would fail the repair.

`sql/posture-checks.sql` covers what no HTTP request can see: that a routine
created now is born unreachable by `anon` and still reachable by
`authenticated`, that `apply_workflow_transition` refuses a foreign transition
when called directly with its ACL out of the way, that a folder called `100%`
renames itself and nothing else, and that `validate_share_link` and
`consume_share_link` admit exactly the same callers.

That last one used to compare the two functions on `require_auth` alone, which
is one axis of an admission decision with six. The two disagreed about a
soft-deleted file — validate refused, consume spent a download — for a whole
release while the check passed. It now walks every `(link, caller)` pair over a
matrix of link states (good, expired, deactivated, allowance exhausted, file
deleted, token unknown) and callers (`anon`, another organization's member, the
owner), and requires the two answers to be equal in all of them.

### The controls on the controls

`negative-controls.ps1` proves that `tools/verify-schema.sql` refuses a database
with a hole in it. Nothing asked the same question about the other two
verifiers, and both of them certified the exact hole they were written to catch:
`tools/emergency-lockdown.sql` printed `PASS - ... no view is [readable by anon]`
over a column-granted view serving two tenants' part numbers, and reached that
PASS by counting anon-executable routines against the number three rather than
checking they were the allowlisted three; `sql/repair-config-maps-proof.sql`'s
case 23, documented as the sentinel that proves the suite discriminates, never
called the function.

`tooling-controls.ps1` closes that. Each control reintroduces one of those
conditions and requires the fixed tool to catch it — and asserts its own premise
first, including that the *old* predicate really was blind to it, so a control
cannot pass by testing something else. **LC0 runs first and is a positive
control:** the three pre-login routines (`get_org_auth_providers`,
`validate_share_link`, `consume_share_link`) must still be reachable by `anon`
after the lockdown, or a script that revoked everything from everyone would
satisfy every other control while taking the sign-in screen down with it.

To show the controls would fail against the unfixed script, point them at a copy
of it:

```powershell
git show <commit>:supabase/tools/emergency-lockdown.sql |
  Set-Content harness\sql\_pre-fix-lockdown.sql -Encoding utf8
.\tooling-controls.ps1 -LockdownScript /sql/_pre-fix-lockdown.sql -Only LC1,LC2,LC3
```

### The policy controls

`schema_release_manifest()` has kinds `'table'` and `'function'` and no
`'policy'`, so `check_schema_release()` cannot see a row-level security policy
at all. A database whose `users` self-update policy has silently lost its
`WITH CHECK` verifies clean and stamps. Five of schema 95's seven fixes are
policies, which leaves the manifest unable to pin the most severe fix in the
release.

`policy-controls.ps1` is the substitute. It runs each fix twice:

1. against the release as it stands, where every assertion must hold;
2. with that one fix reverted to its schema-94 text — taken verbatim from
   `git show HEAD:` and kept in `sql/revert-*.sql` — where the assertions that
   close a hole must report it open again.

The second half is the point. An assertion that refuses both before and after
the fix is not evidence of the fix, and each fix declares which assertion ids
must flip; one that does not flip is reported as an **inert control** rather
than as a pass. Everything a fix does *not* declare is expected to hold in both
phases, and the fix table says why for each one: the four regression controls
(`4`, `12`, `20`, `30`) and the other positive controls must not move, and
`A1a/5`, `A3/11`, `A4/15`, `A4/17`, `A6/27` and `A6/28eq` are refused by terms
older than schema 95 or by a clause in a different policy. A1b declares nothing
at all, which is how A's claim that its added `WITH CHECK` is a no-op gets
executed rather than believed.

The real policy is put back from a snapshot of the *live* definition taken at
the start of the run (`sql/policy-snapshot.sql`), not from a copy kept in the
harness. A restore that reinstalled a stale copy would leave every later
assertion measuring the harness's idea of the schema instead of the schema —
the same defect one level up.

`sql/policy-fixtures.sql` adds the six accounts the assertions need. The seed
has only organization administrators and an account in no organization, and
`is_org_admin()` short-circuits `user_has_permission()` to true, so no seeded
account can prove anything about a permission term. The fixtures are
authoritative rather than additive, and re-applying them is what undoes the
damage a reverted policy lets through — an A1a escalation really does move a
viewer into another organization as its administrator.

A6 is reverted by mutating `may_review_gate()` to return `true` rather than by
restoring a policy, because the schema-94 defect was the *absence* of a reviewer
branch in `complete_gate_review()`. The mutant reproduces the same observable
behaviour through the branch that now exists, without carrying 160 lines of
unrelated workflow machinery in the harness. See `sql/revert-a6.sql`.

### `storage.objects`

`sql/storage-objects-fixture.sql` builds a `storage.objects` the harness can
attack, seeded with one object per tenant at BluePLM's real path shape
`{org_id}/{hash[0:2]}/{hash}`, plus Supabase's `storage.foldername()`. Nothing
in `supabase/` creates that table — it belongs to the Storage service — which is
why no release has ever been able to assert anything about the vault bucket.

**The cross-tenant read control is reported as not applicable, pending A2.** The
four vault policies are not in version control, so with RLS enabled and zero
policies `authenticated` reads nothing: "Bob cannot read Acme's object" is true
today and means nothing, because Alice cannot read her own either. Scoring that
as a pass would be the exact failure this whole directory exists to prevent. The
assertions are written and will run against the four names in
`A_AGENT_REPORT.md` section 4 the moment they are committed.

What *is* executed now is the advisory storage section `verify-schema.sql`
gained in schema 95: that it warns when RLS is off, and that it never withholds
the stamp in either state. A check that blocks on unknown policies is a check
nobody can clear.

## Evidence

`evidence/` holds the captured runs: the attacks before and after the fix,
verification before and after, the negative controls, the tooling controls, the
policy controls, and the upgrade lane. Every file in there is the unedited
output of the script named at the top of it, and every one of them can be
regenerated by running that script:

```powershell
.\capture-evidence.ps1 -Baseline ../../blueplm-v90/supabase   # 01, 02
.\capture-evidence.ps1                                        # 00, 03, 04, 05, 06, 08, 09
.\capture-evidence.ps1 -Upgrade                               # 07
.\evidence\stage2\run-all.ps1                                 # the whole release sequence, one file per script
```

`evidence/stage2/` is the schema-95 sign-off run: all six scripts in order, one
capture each. It exists as its own script because every script here reports
through `Write-Host`, which writes to the host and not to the success stream, so
`.\x.ps1 | Tee-Object` produces an empty file while the operator watches the
output scroll past. Running each script as a child process turns that host
output back into stdout, which can be redirected.

`06-lockdown.txt` is captured after `sql/reopen-for-lockdown.sql` has put the
database back into the open state, so the run shows the script revoking
something. It did not used to: the comment claiming the reopen said so over a
capture that recorded `Revoked EXECUTE from anon on 0 function(s)`.
