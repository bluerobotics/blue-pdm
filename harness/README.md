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

## Two things the scripts refuse to do

**Score a connection failure as a refusal.** `attack.ps1` once reported "every
attack was refused" with the PostgREST container stopped. It now checks the API
answers and the seed is present before it starts, and any request that does not
reach the server voids the run.

**Report a pass over a broken application.** Every attack failing is also what
you get from a schema that was simply revoked into uselessness. The positive
controls check the things that must keep working — a member reading their own
organization's parts through `parts_with_pricing`, minting and redeeming a share
link for their own file, the sign-in screen reading auth providers with the anon
key — and a broken one voids the run too.

## The tenants

`sql/seed.sql` creates two organizations and four accounts. The one that matters
is `mallory@nowhere.test`, whose `users.org_id` is `NULL`: that is the account
the NULL-unsafe membership tests admit, and testing as `postgres` with
`auth.uid()` null does not reach it. There is also a `ghost` organization whose
auth providers are exactly what the function returns for an organization that
does not exist, which is what makes the enumeration test fair.

## Evidence

`evidence/` holds the captured runs: the attacks before and after the fix,
verification before and after, and the negative controls.
