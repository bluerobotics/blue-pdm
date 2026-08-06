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
.\attack.ps1 -Expect fixed                     # the attack suite
.\negative-controls.ps1                        # reintroduce each hole, require the verifier to catch it
```

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
when called directly with its ACL out of the way, that `validate_share_link` and
`consume_share_link` agree about `require_auth`, and that a folder called `100%`
renames itself and nothing else.

## Evidence

`evidence/` holds the captured runs: the attacks before and after the fix,
verification before and after, and the negative controls. Every file in there is
the unedited output of the script named at the top of it, and every one of them
can be regenerated by running that script.
