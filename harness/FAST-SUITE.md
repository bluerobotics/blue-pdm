# Making the negative controls cheap enough to run

`negative-controls.ps1` takes about 21 minutes. Nothing that takes 21 minutes
gets run on a commit, and a suite that only runs at release time is a suite that
finds things late. This is a second implementation of the same controls, added
alongside the original, plus an audit of the checks it exercises.

## Nothing here was measured

I could not run anything. The harness was in use by another agent for the whole
of this work, so no Docker command, no `psql`, and none of the `harness/*.ps1`
scripts were executed, not even to time them. Every duration in this document is
derived from reading the code and is marked with a confidence level. The counts
of round trips, verification runs and files are exact - those were counted, not
estimated - but what any of them costs in seconds is inference.

I also did not modify a single file the other agent will execute. Everything
here is new: a new driver, a new `harness/sql/fast/` directory, and a compose
override. The originals are untouched.

Two consequences worth stating before anything else. First, the 21 minutes is
your number, not mine, and the model below is calibrated against it; if the real
figure is 15 or 30 the ranking still holds but the arithmetic moves. Second, the
first person to run `negative-controls-fast.ps1 -Timing` will learn more about
where the time goes than this entire document contains.

---

## 1. The cost model, ranked

Counted exactly, by reading `negative-controls.ps1`:

| | count |
|---|---|
| controls run through `Test-Control` | 18 |
| `docker compose exec` process spawns per run | **147** |
| `tools/verify-schema.sql` runs per run | **40** |
| database rebuilds inside the suite | 0 |
| container restarts inside the suite | 0 |
| fixed `Start-Sleep` calls inside the suite | 0 |

`Test-Control` spawns `6 + repair files + cleanup files` processes: set the stamp
to 0, apply the hole, verify, read the stamp, repair, verify, read the stamp,
clean up. All 18 controls have one repair file and six have a cleanup file, so
`18 x 7 + 6 = 132`. The preamble adds 4, NC7 adds 8, the posture block 1, the
final check 2. Two of those 147 are verifications per control, plus one in the
preamble, two in NC7 and one at the end: 40.

### Rank 1 — the 40 verification runs. Confidence: high that this is the majority; medium on the exact share.

If a verification costs 27 seconds, 40 of them is 18 of the 21 minutes. That
number is arrived at by subtraction rather than measurement: 147 spawns at
roughly 1.2s of Docker and compose overhead each is about 2 minutes, the five
release-module re-applies are perhaps another minute, and what is left over
divided by 40 is around 27 seconds. Every step of that is an estimate. What is
not an estimate is that verification runs dominate the count of expensive
things, and that no rearrangement of the PowerShell can make one cheaper.

Inside a verification, in the order I would bet on them:

**1a. `strip_sql_noise()`, six full passes per run. Confidence: medium.**
`verify-schema.sql` calls `check_null_unsafe_org_gates()` at lines 396 and 402
and `check_unbound_entity_args()` at 426 and 432, and `verify_and_stamp_schema()`
calls each once more - three times each. Both scan every function body in
`public` through `strip_sql_noise()`, which walks the text one character at a
time in PL/pgSQL, executing two `substr()` calls and several branches per
character. The installed SQL is 769 KB across `core.sql` and six modules; the
function bodies inside it are a large minority of that, so call it a quarter of
a million characters. Six passes is roughly 1.5 million loop iterations per
verification and 60 million across the suite. PL/pgSQL interprets each one.

The `v_out := v_out || c` accumulator inside that loop is quadratic, and I
initially had it as the headline. On the numbers it is not: bodies average a few
hundred characters, so the quadratic term is a few tens of megabytes of `memcpy`
per pass, which is milliseconds. **The cost is the interpreter, not the
concatenation.** Correcting that changed which fix is worth making.

**1b. `check_org_gates()` executing every probed function. Confidence: low-medium.**
It `EXECUTE`s each SECURITY DEFINER function that takes a `p_org_id`, inside a
subtransaction, with synthesized arguments. Subtransactions are not free and
neither are the plans. I have no way to guess how many functions qualify without
running the query.

**1c. `check_anon_reach()` per-column privilege tests. Confidence: low.**
`has_any_column_privilege` over every relation in `public`. Catalogue lookups
are cached and cheap; I list it because it is O(columns) and I could be wrong.

### Rank 2 — 107 non-verification process spawns. Confidence: high on the count, medium on the cost.

`docker compose exec` is not `exec`. Compose parses `docker-compose.yml`,
resolves the project and the service, talks to the daemon, and allocates a TTY,
per call. On Windows with Docker Desktop, somewhere between 0.7 and 1.5 seconds
is the usual range. At 1.2s, 107 of them is a little over 2 minutes - a tenth of
the runtime, worth removing but not the story.

This is where the brief's first prediction lands: one process per statement
instead of one session for many is real and is happening. It is just not the
dominant term, because what those processes are running is so much more
expensive than starting them.

### Rank 3 — re-applying release module files. Confidence: medium.

Eighteen repairs re-apply a file. Five of those are release modules:
`10-source-files.sql` (227 KB) twice, for NC2 and NC17, plus `30-supply-chain`,
`50-extensions` and `60-customers`. Re-running 227 KB of `CREATE OR REPLACE` is
thousands of catalogue writes. Estimate 10-20 seconds each, so roughly a minute
across the suite.

### Rank 4 — durability settings. Confidence: medium.

The container runs with default `fsync`, `full_page_writes` and
`synchronous_commit` on a database that `docker compose down -v` destroys. The
suite is commit-heavy and small-transaction, which is the shape that waits on the
disk most. Turning them off is commonly worth 2-5x on such workloads - though the
verification itself is CPU-bound, so the benefit lands mostly on `reset.ps1` and
on the module re-applies rather than on rank 1.

### Rank 5 — sleeps and rebuilds. Confidence: high. **These are not the problem.**

The brief predicted fixed sleeps, per-check rebuilds and container restarts. In
this suite there are none of any of them. `reset.ps1` polls the container
healthcheck (with a 3-second interval, so it over-waits by 1.5 seconds on
average - one and a half seconds, once, outside the suite), and `rest-ready.ps1`
polls PostgREST at one-second intervals with a timeout, which is already the
right shape. The database is built once by `reset.ps1` and the controls run
against it; nothing is torn down between checks. Whoever wrote this harness had
already avoided the usual mistakes.

### What this implies

The floor is `(number of verification runs) x (cost of one verification)`.
Everything else is a tenth of the runtime. So the tiers are, mostly, a way of
choosing that first number, and the one deep fix available is `strip_sql_noise()`
- which lives in the artefact under test and therefore cannot simply be edited.

---

## 2. What is new

Nothing existing was modified.

| file | what it is |
|---|---|
| `harness/negative-controls-fast.ps1` | the driver: three tiers, real `-Only`, `-Timing`, `-SelfTest` |
| `harness/docker-compose.fast.yml` | compose override: `fsync=off` and friends, 1s healthcheck |
| `harness/sql/fast/nc-signature.sql` | `harness_fast.catalog_signature()`, the proof that a rollback restored the database |
| `harness/sql/fast/nc-endpoint-census.sql` | enumerates SECURITY DEFINER routines `authenticated` can reach that no check probes |
| `harness/sql/fast/nx1-*.sql` | fixture, repair and teardown for `check_release_residue()`'s workflow-history branch |
| `harness/sql/fast/nx2-*.sql` | the same for its workflow-assignment branch |
| `harness/sql/fast/selftest-*.sql` | fixtures that make the runner's own failure paths execute |
| `harness/sql/fast/strip-sql-noise-fast.sql` | **opt-in, not for release gates.** A proof-gated replacement for the hot function |

`harness/sql/fast/census-baseline.txt` is deliberately absent. The first run
writes it, because I cannot know what is in the census without querying a
database.

---

## 3. Tiers

| tier | verifications | psql sessions | estimated wall time | for |
|---|---|---|---|---|
| `-Tier smoke` | **1** | 4 | **30-45s** | every commit |
| `-Tier standard` | 25 | 29 | 11-13 min | a branch, a lunch break |
| `-Tier full` | 45 | 48 | 20-22 min | release gate |

Estimates assume ~27s per verification and no `docker-compose.fast.yml`.
Confidence: medium, and entirely dependent on rank 1 being right.

```powershell
.\negative-controls-fast.ps1 -Tier smoke
.\negative-controls-fast.ps1 -Tier standard
.\negative-controls-fast.ps1 -Tier full -ExpectRelease 96
.\negative-controls-fast.ps1 -Tier standard -Only NC18,NC19 -Timing
.\negative-controls-fast.ps1 -SelfTest
```

**smoke** applies every hole inside one transaction, verifies once, rolls back.
The baseline is read from `schema_version` rather than re-verified - only
`verify_and_stamp_schema()` writes that row and only on an empty problem list, so
the stamp is the last verification's verdict. NC7, the stamp control and the
posture checks are off unless named in `-Only`. It is not a release signal, and
it says so on every run.

**standard** isolates each control in its own transaction and rolls it back. No
repair phase, so half the verifications disappear. What it gives up is the
assertion that re-running the named module file repairs the hole; it prints, per
control, that the assertion was not made.

**full** is the original flow with the original assertions, in two sessions per
control instead of seven or eight. It has *more* verification runs than the
original (45 against 40) because it adds two controls and a stamp control; the
saving is the 100 fewer process spawns. Expect parity on time and more coverage.

**A middle tier without new code.** `-Tier smoke -Only NC1,NC2,NC3,NC4,NC5` runs
those five in one transaction with one verification. Four such groups cover
everything in about four verifications - roughly two minutes - with the masking
caveat that applies to any batch.

### `-Only` actually filters now

`negative-controls.ps1` guards `Test-Control` with `-Only` but runs NC7 and the
posture block unconditionally, and increments `$Ran` for neither. So
`-Only NC1` runs NC1, then NC7, then the posture checks, and then prints
`FAIL: no control executed`. In the fast runner `NC7`, `STAMP`, `CENSUS` and
`POSTURE` are ordinary ids.

---

## 4. Swap-in

There is nothing to swap. Every file is new and the originals still work. The
cutover is a decision, not an edit:

1. **After the other agent finishes**, run the equivalence check in section 5.
2. If the verdicts match, point CI at `negative-controls-fast.ps1 -Tier smoke`
   for commits and `-Tier full` for the release gate.
3. Keep `negative-controls.ps1` until `-Tier full` has gated one real release.
   Two implementations that agree are evidence; one implementation is a hope.

To use the durability override, set it for the session so that every existing
script picks it up without being edited:

```powershell
$env:COMPOSE_FILE = 'docker-compose.yml;docker-compose.fast.yml'
.\reset.ps1
.\negative-controls-fast.ps1 -Tier standard
```

Windows uses `;` as the compose path separator. Unset it, or open a new shell, to
go back. Nothing in that file changes what any transaction sees - only when bytes
reach the disk - so no verdict can depend on it.

---

## 5. How to validate this before trusting it

Three checks, in order. The first is the one that matters.

**(a) The two implementations reach the same verdicts.**

```powershell
cd C:\Users\emill\Documents\GitHub\bluePLM\harness
.\reset.ps1
.\negative-controls.ps1      *>&1 | Tee-Object -FilePath ..\evidence\nc-original.txt
.\reset.ps1
.\negative-controls-fast.ps1 -Tier full *>&1 | Tee-Object -FilePath ..\evidence\nc-fast-full.txt
```

Then compare the verdict lines only - the fast runner prints extra material:

```powershell
$pat = '^(---|  caught:|  NOT CAUGHT|  repaired:|  REPAIR FAILED|OK:|FAIL:)'
$a = Select-String -Path ..\evidence\nc-original.txt  -Pattern $pat | ForEach-Object { $_.Line.Trim() }
$b = Select-String -Path ..\evidence\nc-fast-full.txt -Pattern $pat | ForEach-Object { $_.Line.Trim() }
Compare-Object $a $b
```

What proves equivalence: every `--- NCn` line present in both, every `caught:`
line identical, every `repaired: stamped again at <release>` identical, and both
ending `OK:`. The fast run has extra lines the original has no counterpart for -
`NX1`, `NX2`, `STAMP`, `CENSUS` - and those should appear only on the right side.
Anything else in the `Compare-Object` output is a real difference and should
block the cutover.

**(b) The runner can fail.**

```powershell
.\reset.ps1
.\negative-controls-fast.ps1 -SelfTest
```

Five cases deliberately break a control and require the runner to report it
broken: a hole that opens nothing, a real hole with the wrong expected token, a
missing hole file, a repair that repairs nothing, and a hole that commits itself
so that the rollback cannot undo it. `SELF-TEST OK` means all five failure paths
executed and were reported. Anything else means passes from this runner mean
nothing, and it exits 1. It restores the database itself, including the stamp.

**(c) The smoke tier agrees with the standard tier.**

```powershell
.\reset.ps1
.\negative-controls-fast.ps1 -Tier smoke
.\negative-controls-fast.ps1 -Tier standard
```

Both should report the same controls caught. A control caught in `standard` and
not in `smoke` is one hole masking another, which is the batching risk made
visible; the smoke output names it and tells you which command to re-run.

---

## 6. Equivalence, one optimisation at a time

**One psql session per phase instead of one process per statement.** Each
statement runs in the same order, against the same database, as the same role.
The only thing that changes is that they share a connection. The values the
script reads back are carried on `@@NC|key|value` lines rather than being the
sole content of a process's stdout, so a session that dies early is detected by
the line being absent - which is strictly more reliable than reading an exit
code that the original discarded with `| Out-Null`.

Order of the merged streams is not relied on anywhere. `psql` block-buffers
stdout when it is not a terminal and writes stderr unbuffered, so an `\echo`
marker cannot be trusted to arrive before the NOTICEs it precedes. Every value
is on a self-identifying line that can be found anywhere in the output.

**"Did the hole apply?" from an absent emission instead of scanning for `ERROR:`.**
The original applies the hole with `ON_ERROR_STOP=1` and then tests the captured
text with `-cmatch 'ERROR:'`. The fast runner keeps `ON_ERROR_STOP` on for the
hole and puts a marker `SELECT` immediately after it: if the hole fails, `psql`
exits at that point and the marker never prints. Same condition - `ON_ERROR_STOP`
is what makes `psql` stop, and the `ERROR:` prefix is what it prints on the way -
detected without reading the text. This also removes a latent bug: NC7 in the
original uses `-match 'ERROR'`, case-insensitive and without the colon, so a
NOTICE containing the word "error" would have been reported as a hole that failed
to apply.

**Rollback instead of repair (standard and smoke).** No hole file contains
`BEGIN`, `COMMIT` or `ROLLBACK`; the only `BEGIN`s in `harness/sql` open PL/pgSQL
blocks. PostgreSQL rolls back DDL, so `ROLLBACK` restores the catalogue exactly -
a stronger guarantee than re-running a module file, which restores the object the
module owns and says nothing about anything else the hole touched.

This is asserted, not assumed. After every rollback, `harness_fast.catalog_signature()`
is recomputed and compared with the baseline. The signature covers every input
the seven check functions read: routine identity, source, ACL and flags;
relation kind, ownership, `reloptions`, `relrowsecurity`, `relacl`; **column**
ACLs, because `has_any_column_privilege` is true where `has_table_privilege` is
false and that gap is an entire class of exposure; policies with their `USING`
and `WITH CHECK` text; default privileges; and `check_release_residue()`'s own
output for the data half. If the signature matches, the inputs to every check are
the inputs the baseline verified clean with, so a second verification could only
reach the same verdict. If it does not match, the run says so and fails.

Two assertions do not survive this and are not quietly dropped:

- *"Re-running the module file repairs it."* Printed as not asserted, per
  control, with the file named. `-Tier full` asserts it.
- *"`schema_version` still holds 0 after the refusal."* The transaction is
  aborted by then and cannot be queried. The property is asserted once per run
  instead of eighteen times, by the STAMP control, which is stronger than what it
  replaces: it calls `verify_and_stamp_schema()` on a holed database and requires
  `stamped=false` with the row unmoved, **and** on a clean one and requires
  `stamped=true` with the row written. Eighteen copies of the first half alone
  would all pass against a function that never wrote anything.

**Reading the baseline stamp instead of re-verifying (smoke only).** Only
`verify_and_stamp_schema()` writes `schema_version`: it is revoked from every
client role, `update_schema_version()` was reduced to a no-op precisely so that
modules could not stamp, and the write happens only on an empty problem list. So
`schema_version = schema_release_version()` means the last verification passed.
What it does not cover is a change made after that stamp, which is why the other
two tiers still verify. This is a stated weakening, not an equivalence claim.

**Batching every hole into one transaction (smoke only).** Genuinely weaker: one
hole could change what the verifier says about another. The mitigation is that
each control's expected tokens are still required individually, so masking
presents as a named control failing rather than as a quiet pass, and the message
says which command re-runs it in isolation. Smoke is not a release signal.

**Wrapping the posture checks in a transaction.** This is a fix, not an
optimisation. `posture-checks.sql` section 2 applies a real workflow transition
to `aaaaaaaa-3333-...-002` and leaves it applied, so a second run finds the file
already in the destination state, the legitimate move is refused, and the block
raises `OVER-BOUND`. The file is not re-runnable against one database, which
means `negative-controls.ps1` only passes immediately after a reset - `attack.ps1`
works around exactly this for its own C8 control by trying the transition and
then the reverse. Every assertion in the file is made before the rollback, so
rolling back changes nothing it tests, and the signature check afterwards proves
the database came back.

**`fsync` and friends off.** Every setting in `docker-compose.fast.yml` concerns
when bytes reach the disk. None changes what a transaction sees, when a lock is
taken, what a catalogue query returns, or which errors are raised. A committed
transaction is still committed to every session; it is merely not guaranteed to
survive the machine dying, on a container that `docker compose down -v` destroys.

**Replacing `strip_sql_noise()` — opt-in, and not for releases.** The
implementation in `sql/fast/strip-sql-noise-fast.sql` keeps the same four-state
machine and the same index arithmetic, and only jumps between the characters that
can change state instead of visiting every character. It installs itself into
`harness_fast`, runs a differential test against the shipped function over 35
adversarial cases *and* every installed function body in both `prosrc` and
`pg_get_functiondef` form, and replaces `public.strip_sql_noise` only if all of
them agree exactly. If any disagree it raises and replaces nothing.

Three properties had to hold for the swap to be invisible, and all three were
checked in the source: `strip_sql_noise` is not an object in
`schema_release_manifest()` (the manifest mentions the name only as a substring
required inside `check_null_unsafe_org_gates()`, so no `stale` row appears);
`check_null_unsafe_org_gates()` excludes itself and `strip_sql_noise` from its
own scan; and `CREATE OR REPLACE` preserves owner and ACL.

Even so: this replaces part of the artefact under test with code that is not in
the release. Development loops yes, release gates never. Revert with `reset.ps1`.

---

## 7. Checks whose failure branch has never executed

NC19 found `text[] || 'anon'` resolving to `array_cat` and dying on "malformed
array literal", on a line that only runs when a function *is* reachable - so
every clean run had stepped over it. That is not a one-off; it is what happens to
any branch nothing exercises. Below is every instance I can find by reading, with
what I did about each.

### Fixed: new controls

| branch | where | evidence it never ran | what I added |
|---|---|---|---|
| `residue := 'cross_tenant_workflow_history'` | `core.sql:2298` | a fresh install has no residue; NC12 produces residue of the share-link kind only; nothing else creates these rows | **NX1** plants an Acme history row naming Umbrella's workflow, requires the check to report it, repairs by running the advertised `remediate_cross_tenant_workflow_history()` rather than by deleting the row, and asserts the redaction actually took |
| `residue := 'cross_tenant_workflow_assignment'` | `core.sql:2327` | same | **NX2** assigns a seeded Acme file to Umbrella's workflow, requires the report, repairs by remediation, and additionally asserts the remediation did *not* also delete the legitimate assignment |

Both fixtures assert their own premise: if the row did not land in a state that
satisfies the check's predicate, the fixture raises, so "the verifier missed it"
can never be a fixture that quietly failed to insert.

NX1 and NX2 also exercise the *repair* side of the same never-run branches -
`remediate_cross_tenant_workflow_history()`'s history redaction (four NOT NULL
columns set to markers, four foreign keys nulled) and its assignment deletion.
Those had never executed either.

### Fixed: whole classes nothing enumerates

**The CENSUS check.** NC18 and NC19 are two instances of one defect: a SECURITY
DEFINER routine in `public` with no `p_org_id`, executable by `authenticated`,
and not on the five-name hand-maintained `withdrawn_execute_manifest()`, is
examined by nothing at all. `check_anon_reach()` asks about `anon`.
`check_org_gates()` only probes routines taking a `p_org_id` - "correctly and
uselessly", as `core.sql` puts it. `check_withdrawn_execute()` only looks at the
five. `core.sql` says out loud that the list is hand-maintained and that "the
cost of leaving one out is what release 95 nearly shipped".

`sql/fast/nc-endpoint-census.sql` computes that set. It does not judge it - most
of those routines are the application's own RPCs and have to be callable - it
records it in `census-baseline.txt` and fails when the set **grows**. The next
`cleanup_extension_http_logs` then arrives as a line in a diff at the moment it
is created.

**The runner's own failure paths.** `-SelfTest` deliberately trips five of them
(section 5b). ST5 is the important one: it makes a change the rollback cannot
undo and requires the signature comparison to catch it. Without ST5 the
signature check is decoration, and every claim the rollback tiers make rests on
it.

### Reported, not fixed

These have no control and I did not add one. In each case I say why.

| branch | where | why it has never run | recommendation |
|---|---|---|---|
| `status := 'missing'` for a table | `core.sql:717` | no control drops a manifest object | worth a control; see below |
| `status := 'missing'` for a function | `core.sql:729` | same | same |
| `status := 'absent'` in `check_withdrawn_execute()` | `core.sql:2395` | fires when the manifest names a routine that does not exist - only reachable by editing the manifest | low value; the manifest is five entries and is read every run |
| `status := 'skipped'` | `core.sql:706` | partial installs only (`install.ps1 -Modules`) | exercised by the module lane, not this suite; worth one assertion there |
| the `v_updated = 0` exception in `verify_and_stamp_schema()` | `core.sql:2557` | fires when the caller cannot write `schema_version`; the harness always runs as `postgres` | worth a one-line control connecting as `authenticated` and requiring the exception - it is the branch that stops a non-writer being told the schema was verified |
| `advisory` severity for tables and views | `core.sql:1598-1608`, and the view blocks | only the *routine* advisory path is exercised, by NC7 | a table owned by `supabase_admin` in `public` would do it; NC7's fixture shows the shape |
| plain table with no RLS (`relkind = 'r'`) | `core.sql:1594` | NC14 covers `'p'`, NC15 covers RLS-with-open-policy, nothing covers the plainest case of all | cheap control, and it is the single most likely real-world mistake |
| foreign table (`relkind = 'f'`) | same block | needs an FDW in the harness | not worth it |
| `status := 'inconclusive'` | `core.sql:1263` | *probably does* run on every clean database, for unreachable functions - but nothing asserts it, so "probably" is doing work here | assert the count is stable rather than zero |
| `status := 'ungated'` at `core.sql:1199` (ran to completion) | | NC10 and NC13 reach the `ungated` verdict through the raise path at 1218; whether anything reaches 1199 depends on whether a probed function completes | check with `-Timing` output in hand; if nothing reaches it, one fixture that returns normally would cover it |

The `missing` control is the one I would add next, and I wrote it out rather than
shipping it untested:

```powershell
@{ Id='NX3';  What='a manifest function dropped outright'
   Hole='/sql/fast/nx3-drop-manifest-function.sql'; Tokens=@('missing','create_file_share_link')
   Repair=@('/blueplm/modules/10-source-files.sql'); Cleanup=@(); RepairIsRemedy=$true }
```

I did not ship it because I cannot run it, and its blast radius is different from
NX1 and NX2's. Those plant a row and remove it. This one drops a shipped function
and depends on a 227 KB module re-apply to restore it; if the re-apply is
incomplete in `-Tier full`, every control after it fails against a broken
database. Try it in `-Tier standard` first, where the rollback makes it free, and
promote it once it has passed.

### Not a failure branch, but found while looking

- **`-Only` is broken in the original.** It guards `Test-Control` but runs NC7
  and the posture block unconditionally without incrementing `$Ran`, so
  `-Only NC1` runs three things and then reports `FAIL: no control executed`.
  Fixed in the fast runner.
- **NC7's error test is inconsistent with every other control's.** `-match 'ERROR'`
  against `-cmatch 'ERROR:'`. Dead code today, wrong the day it runs. The fast
  runner does not read the text at all.
- **`posture-checks.sql` is not idempotent.** Section 2 leaves a workflow
  transition applied, so the suite only passes immediately after a reset. Fixed
  by rolling it back; see section 6.

---

## 8. Why `attack.ps1` reported 0 of 20 against a schema with two real holes in it

Because it can only find holes somebody had already found.

`attack.ps1` is a fixed list of about twenty named cases - `F2a`, `F3a`..`F3e`,
`F4a`..`F4f`, `F5a`, `F6a`, `F6b`, `F7a`, `F8a`, `F8b` - and the naming gives it
away: `F2` is finding 2, `F3` is finding 3, `F4` is finding 4. Each one is a
regression test for a specific hole that was found by hand and then closed. There
is no step anywhere in the file that enumerates the PostgREST surface and tries
things against it. It cannot report a hole that does not have a case, and every
case corresponds to a hole that is already fixed.

So `0 of 20` was the correct output, and it meant "the twenty holes we already
knew about are still closed". It was read as "the schema is clean". Those are
very different statements and nothing in the output distinguishes them.

The two tenancy holes `negative-controls` then found - `seed_customer_categories`
and `cleanup_extension_http_logs`, both granted to `authenticated` by Supabase's
`ALTER DEFAULT PRIVILEGES` - have no `F` case. They are not variations on any of
the twenty. They are routines that were simply never on anybody's list.

**Is coverage the problem rather than speed?** Both, and coverage is the bigger
one. The speed problem is why the suite is skipped; the coverage problem is what
it would miss if it ran every hour. But they are the same problem in one respect
that matters here: every enumeration in this codebase that decides what gets
checked is hand-maintained. `attack.ps1`'s twenty cases,
`withdrawn_execute_manifest()`'s five names, `anon_execute_allowlist()`,
`anon_read_allowlist()`, `schema_release_manifest()`. Each is a list of things
somebody thought of. The CENSUS check is the one thing I added that computes a
set rather than reading one, and it is the piece of this work I would keep if I
could keep only one.

---

## 9. Claims in the brief that did not survive the code

- **"One process spawn per SQL statement instead of one session for many."**
  True - 147 of them - and worth fixing, but it is about a tenth of the runtime,
  not the dominant cost. Removing 119 of them saves roughly two minutes out of
  twenty-one.
- **"Tearing down and rebuilding the database between checks."** Does not happen.
  `reset.ps1` runs once, before the suite. There is nothing to remove.
- **"Fixed sleeps."** None in the suite. `reset.ps1` polls a healthcheck and
  `rest-ready.ps1` polls PostgREST with a timeout; both are already the right
  shape. The only waste is a 3-second poll interval where 1 would do, worth about
  1.5 seconds once per reset.
- **"Container restarts."** None.
- **"Per-object loops that re-query `pg_catalog`, replaceable with one set-based
  query."** The loops exist - `check_schema_release()` and `check_org_gates()` are
  both `FOR ... LOOP` over catalogue rows - but they are in `core.sql`, which is
  the artefact under test. Rewriting them would mean verifying the release with
  code that is not in the release. This is the constraint the brief's technique
  list does not account for, and it is why the one deep fix here
  (`strip_sql_noise`) ships as opt-in with a differential proof and a warning
  rather than as part of the suite.
- **"Template databases / volume snapshots to restore baseline state in
  seconds."** Not needed, and it would be slower than what is here.
  `CREATE DATABASE ... TEMPLATE` requires no other session connected to the
  template and a reconnect, and transaction rollback already restores the
  catalogue exactly, in microseconds, without leaving the connection.
- **"Turn off fsync (frequently a 2-5x win)."** Applies, and the override is
  written, but the benefit lands on `reset.ps1` and the module re-applies rather
  than on the verification runs, which are CPU-bound in PL/pgSQL. Expect it to
  help `-Tier full` and barely touch `-Tier smoke`.
- **"`negative-controls.ps1` alone is ~21 minutes."** Taken as given and used to
  calibrate. I could not check it.

And the claim of mine that changed while I was writing it: I had
`strip_sql_noise()`'s quadratic string concatenation as the headline cost, on the
arithmetic that a full pass moves close to a gigabyte. That arithmetic was right
and the conclusion was wrong - the bodies are short enough that the quadratic term
is tens of megabytes of `memcpy`, which is nothing. The cost is the PL/pgSQL
interpreter executing a loop body a quarter of a million times, six times per
verification. The fix that follows from the corrected model is different: not a
better accumulator, but not visiting most of the characters at all.

---

## 10. What I did not verify

I did not run the fast suite. I did not run the original. I did not time a
verification, a `docker compose exec`, or a module re-apply. I did not execute
one line of the SQL in `harness/sql/fast/`, including the fixtures that are
supposed to trip the controls and the differential test that gates the
`strip_sql_noise` replacement. The PowerShell parses - that much I checked with
the language parser, which needs no database - and nothing beyond that has been
executed.

Every runtime figure in this document is an estimate derived from reading. The
first real run should be `-SelfTest`, because it is the one that will tell you
whether any of the rest of it works.
