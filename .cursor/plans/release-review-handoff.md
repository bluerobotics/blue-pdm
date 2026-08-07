# Release review handoff: `v3.23.0` → `HEAD`

Written 2026-08-06, revised the same evening after schema 93, schema 94 and the repair UI landed and
the work was pushed. Written for an independent reviewer with no context from the day's work.

**How to read the evidence markers.** Every factual claim below is one of two kinds, and the
difference is the most useful thing in this document:

- **[measured]** — this document's author executed it and read the number off the output. Where a
  command produced it, the command is named so you can re-run it.
- **[reported]** — it comes from a commit message, from the owner, or from an artifact outside this
  repository. Nobody re-ran it. **Treat these as the first things to check.**

The goal is an adversarial review. A defect you find because this document pointed you at a weak
spot is the success case, not an embarrassment.

**This document has been wrong before.** The previous revision was written while schema 93 was being
authored and stated several things that have since stopped being true; each is corrected in place
below and flagged as a correction, rather than quietly overwritten, because knowing *which* claims
decayed tells you which kinds of claim to distrust in the next revision.

---

## 0. What changed since the previous revision

If you read the earlier version of this file, these are the corrections. Four of its claims are now
false and one of its central gaps has been closed.

| Previous claim | Now |
|---|---|
| "Nothing has been pushed" / six commits unpushed | **Everything is pushed.** `main` and `origin/main` are both `8808e12`. See §2. |
| "Do not modify `supabase/` or `harness/` — another agent is mid-flight" | **No other agent is active.** Schema 93 landed in `c7faa60`; both directories are clean and committed. |
| "No GitHub Actions run has ever executed" | **False now.** The workflow has run four times, and the two most recent push-triggered runs exercised typecheck and test on the platform. See §7.1 — this is the biggest single change. |
| "`npm run lint` reports 136 errors and 539 warnings" | **181 errors, 532 warnings, 713 problems** [measured, `npm run lint`]. It got worse, not better. |
| "No lane exists for 85 → 93; five schema releases of drift untested" | **Closed, with a caveat that matters.** See §3 and §7.3. |
| "`migrate_uuid_defaults()` has only ever run against the 93 defaults a v90 database has" | **Closed.** Measured at 103 on an 81 database and 93 on an 86 one; all move. See §3. |
| "The Vault Audit `onRepair` seam and the repair tool are incompatible designs" | **Resolved by replacing the seam**, not by wiring the two together. See §5. |

---

## 1. Orientation: what BluePLM is

BluePLM is a desktop product-lifecycle-management application for engineering teams working in
SOLIDWORKS. It manages a *vault* — a folder tree of SOLIDWORKS documents on disk — plus a database
of item numbers, revisions, descriptions, workflows, RFQs, ECOs and customer data. Five parts:

| Part | Lives in | What it is |
|---|---|---|
| Renderer | `src/` | React + TypeScript + Zustand + Tailwind. The UI, and most business logic. |
| Electron main | `electron/` | IPC handlers, file system, watcher, SOLIDWORKS process lifecycle, extension host. |
| SOLIDWORKS service | `solidworks-service/` | A C# (.NET Framework 4.8) stdin/stdout process. The only thing that touches SOLIDWORKS, via COM and the standalone Document Manager library. Versioned separately (`1.21.0`). |
| REST API | `api/` | Fastify + TypeScript, deployed as a container (Railway / Render). A separate deployable with its own `package.json` and lockfile. Versioned separately (`2.6.0`). |
| Database | `supabase/` | PostgreSQL on Supabase. `core.sql` plus numbered modules. Versioned by an integer `schema_release_version()`. |

Two things about the architecture matter for almost every finding in this release:

- **The database is directly reachable over PostgREST** with a publishable "anon" key. The API is
  not the only door. Any function or view in `public` that `anon` can execute or read is on the
  public internet.
- **SOLIDWORKS files are a second source of truth.** Item numbers, descriptions, revisions and
  per-configuration tabs live both in the database row and in the document's custom properties.
  Most of this release is about the two disagreeing.

### Running things

```powershell
npm ci                            # root deps
npm ci --prefix api               # api/ has its own lockfile; root install does not touch it

npm run typecheck                 # renderer + electron (tsc, both projects)
npm run typecheck:api             # api/, --noEmit only
npm run api:build                 # compiles api/ the way the Dockerfile does
npm test                          # vitest run — the JS/TS suite
npm run test:sw-service           # dotnet test solidworks-service/BluePLM.SolidWorksService.sln -c Release
npm run lint                      # eslint; NOT clean, see §7
```

Node 22 is required. On Node 20 two suites fail to *import* and roughly 25 tests silently do not
run — that was a defect fixed this release and is worth knowing before you interpret a test count.

The security harness (`harness/`) is a Docker Compose stack reproducing a Supabase project's role
and privilege layout so the schema can be attacked. Note that PowerShell here is 5.1: `&&` is not a
statement separator, use `;`.

```powershell
cd harness
.\reset.ps1                            # rebuild, install schema, seed, start PostgREST
.\attack.ps1 -Expect fixed             # the attack suite
.\negative-controls.ps1                # reintroduce each hole; the verifier must catch it
.\upgrade.ps1 -BaselineVersion 81      # apply the release over a damaged old baseline
```

The upgrade lane needs a worktree per baseline, at `../../blueplm-v<N>`:

```powershell
git worktree add ../../blueplm-v81 b3c8e0c --detach   # schema 81
git worktree add ../../blueplm-v86 2f01b91 --detach   # schema 86
```

`supabase/` and `harness/` are **no longer read-only** — the other agent finished. **Do not touch
the vault at `C:\BluePLM\br-vault`.** The owner may have SOLIDWORKS open on it, and the 70 fixtures
under `0 - SHARED\00 - REGRESSION TESTS` must stay byte-identical. Do not rebuild the service binary
(`npm run build-sw-service`); it is at `1.21.0` and verified. Running `npm run test:sw-service` is
safe and does **not** touch it — it compiles into `solidworks-service/*/bin/Release`, while the
bundled binary lives in `resources/bin/win32`. Confirmed by hashing both before and after a full
C# run: all 70 fixtures and all 8 bundled files byte-identical [measured].

---

## 2. Exact state of the tree

All [measured], from `git` at the time of writing:

- **59 commits** in `v3.23.0..HEAD`, 369 files changed, +50,170 / −4,562.
- **`main` and `origin/main` are both `8808e12`. The working tree is clean. Nothing is unpushed.**
- The push was `255a2e4..8808e12`, 13 commits, on 2026-08-06 evening.
- **No tag was created, deliberately.** `v3.23.0` (2026-07-31) is still the newest tag. The owner
  authorised the push and explicitly declined a tag. There is a `chore: Release v3.24.0` commit and
  a dated `3.24.0` changelog section, but no `v3.24.0` tag, so the review range in the title is the
  right one.
- **Historical note worth keeping:** of the 52 commits that existed when this document was first
  written, **46 had already been pushed** and only six were local. A brief that said "nothing has
  been pushed" was wrong about the git remote and right about the *database*. That distinction still
  holds and is still the one that matters: see §3.

### Version files

| File | At `v3.23.0` | At `HEAD` |
|---|---|---|
| `package.json` | `3.23.0` | `3.24.0` |
| `src/lib/schemaVersion.ts` `EXPECTED_SCHEMA_VERSION` | `86` | **`94`** |
| `src/lib/swServiceVersion.ts` `EXPECTED_SW_SERVICE_VERSION` | `1.12.0` | `1.21.0` |
| `api/package.json` | `2.4.0` | `2.6.0` |
| `src/lib/apiVersion.ts` `EXPECTED_API_VERSION` | — | `2.6.0` |

`supabase/core.sql` `schema_release_version()` and `src/lib/schemaVersion.ts`
`EXPECTED_SCHEMA_VERSION` both read **94** and agree [measured]. `api/src/lib/apiVersion.ts` **does
not exist**; the app-side constant is `src/lib/apiVersion.ts` and the API-side number is the
`version` field of `api/package.json`.

`package.json` still reads `3.24.0` while `CHANGELOG.md` heads its top section
`## [3.25.0] - Unreleased`. Per `.cursor/rules/always.mdc` the release gate requires that bump
before a tag. No tag was made, so the gate has not been violated — but the bump is still outstanding
whenever someone does tag.

---

## 3. Production state — read this before you evaluate any schema claim

**The owner's production database is on schema 85, applied 2026-07-31. Nothing from today has been
applied to it.** **[reported]**

The changelog now describes schemas 87 through 94. Every one of those entries describes code that
**is not running anywhere**. When the changelog says a hole is closed, read it as "closed in a
file"; production is nine schema releases behind that file. This cuts both ways: the security fixes
are unproven in production, and so are any regressions they might carry.

### There is no committed tree at schema 85, and that is a finding

**[measured]** `git log -S "EXPECTED_SCHEMA_VERSION = 85" -- src/lib/schemaVersion.ts` returns
nothing. Reading the constant out of every schema-touching commit shows why:

| Commit | Date | `EXPECTED_SCHEMA_VERSION` |
|---|---|---|
| `b3c8e0c` | 2026-07-30 | 81 |
| `2f01b91` | 2026-07-31 | **86** |
| `10d4c5a` | 2026-08-06 | 87 |

The file goes **81 → 86 in one commit**. `2f01b91` folded versions 82 through 86 together and was
committed at 18:33 on the same day production was upgraded. **Production was applied from a working
tree that was never committed**, so a schema-85 database cannot be reconstructed from history and
"prove 85 → 94" cannot be executed literally.

What was done instead is to **bracket it**. Every object a schema-85 database can hold is either in
the 81 tree (objects at or below 81) or was introduced by versions 82–86, all of which are in the 86
tree. So both lanes were built and run, and neither is relabelled 85:

- **81** — `b3c8e0c`, the newest committed tree strictly *older* than production.
- **86** — `2f01b91`, the oldest committed tree containing *everything* production has.

If you only trust one number in this document, make it this one: **production's exact shape was
never installed anywhere, by anybody, and cannot be.** The brackets are the strongest available
substitute, not the thing itself.

### What the older baselines revealed that the v90 lane could not

**The uuid-ossp count is not 93.** **[measured]** `migrate_uuid_defaults()` was written and verified
against the exact 93 `uuid_generate_v4()` column defaults a v90 database happens to have. An **81
database has 103** — the extra ten are in the never-wired advanced workflow tables that schema 86
removed, and **production, being on 85, still has them**. All 103 move; the extension becomes
droppable; a second run moves nothing.

The function survives the difference because it walks `pg_attrdef` rather than a list — but "it
walks the catalogue" was a claim about the code that had never been tested against a database with a
different count. It is now measured on both sides of every lane by
`harness/sql/uuid-default-census.sql`, and the lane **fails** if the extension is still pinned or
the second run moves anything. Three things are asked separately, and the reason is worth noting: a
default missed in a table no release mentions by name would keep the extension pinned **while the
remaining-count reads zero**, so "0 defaults left" is not by itself evidence.

One incidental measurement: in the harness the extension installs into the `extensions` schema, not
`public`. That is the benign case schema 92's notes describe; a project where it landed in `public`
is the one that bricks verification, and this harness does not reproduce that.

**The attack suite assumed objects introduced between 85 and 90.** **[measured]**
`execute_workflow_transition` and the five-argument `apply_workflow_transition` arrive in schema 86.
Against an 81 baseline three attacks and two positive controls ask PostgREST for functions that do
not exist and get `PGRST202`. Scored as originally written, positive control C8 read `BROKEN` and
the whole lane aborted with *"the application is damaged, so 'attacks refused' is meaningless"* —
which is the one thing that had definitely not happened.

This is the thing the 90 lane could not have found, and **it was in the harness, not in the
release.** A `PGRST202` on the baseline half is now reported as `absent`, named explicitly in the
output, and excluded from the must-reproduce list; `F6b` inherits `F6a`'s absence because it reads
back what `F6a` writes. The leniency is confined to the baseline run — after the upgrade the release
has created every one of these, so `PGRST202` there is still a hard failure. Attack this change: it
is the one place in today's work where a check was made *more* permissive.

**No defect in the release itself was found by the older baselines.** That is a real result and it
is also the less interesting one; the honest summary is that the release is fine on this path and
the *test* of the path was not.

### The live bug still running in production

`checkin_file` merged the reserved per-configuration maps in `files.custom_properties` with
`jsonb ||`. That operator is a **top-level** merge: it replaces a nested object rather than merging
into it. Check-in sent only the configurations edited during that checkout, so
`custom_properties._config_tabs` and `._config_descriptions` were replaced with whatever that one
session had touched. Silent, on the success path.

Fixed in **schema 87** — therefore **not fixed in production**. It is still happening on every
check-in the owner performs. Schema **94** adds the repair for rows already damaged (§5).

Measured damage **[reported, from an external audit — artifacts at
`C:\Users\emill\Documents\blueplm-wipe-audit\`, outside this repository]**:

- `ORING-BUNA-70A.SLDPRT` — **1 entry of 68 configurations** in each map.
- `ORING-SILICONE-50A` — **1 of 5**.
- `ORING-FKM-75A` — **intact**: 26 entries against 15 configurations, 11 of them stale keys for
  configurations that have since been deleted.
- A vault-wide query found **zero present-but-empty maps**, so no file lost everything.
- **Roughly ten files** have meaningful loss.

The values were not destroyed. The wipe took the database's copy; the SOLIDWORKS documents still
hold them. That is what makes repair possible at all.

### The measurement that invalidated a heuristic

Comparing map **entry counts** to configuration counts is wrong. `ORING-FKM-75A` is the proof: 26
entries against 15 configurations. By count that reads as a map that has *gained* eleven; by name it
is a complete record plus eleven stale keys for deleted configurations. Nothing was lost.

**Comparisons must be by configuration name.** Two separate pieces of work were built on the count
heuristic before this was caught. If you find a third, it is a real defect. The rule is stated in
`73b80a1` and enforced in `buildVaultAuditView` and in `configMapRepair.ts`; check anything that
compares lengths.

### The vault census

All **8,015 readable models** measured through the Document Manager library in **163 seconds**.
**6,363** have exactly one configuration; **1,652** are multi-configuration; **53** have twenty or
more. Artifacts live outside the repository at `C:\Users\emill\Documents\blueplm-wipe-audit\`.
**[reported]** — the numbers are self-consistent (6,363 + 1,652 = 8,015) but this document's author
did not run the census and cannot see the artifacts.

---

## 4. Where to dig hardest

These are not theoretical. Each is a pattern that produced a real defect, and each recurred more
than once. Look for the *next* instance of each.

**1. A verifier that certifies the very hole it was written to catch.** Three schema releases in a
row shipped this way. v89 read function source text for the *words* of an authorization check, so a
check inside a comment or inside `IF false THEN` passed. v90's anon check asked
`has_function_privilege('public', ...)`, a question about the world grant, while the actual grant
was to `anon` — it printed an all-clear over a completely open database. v91's sweep touched
`prokind = 'f'` while its grader looked at every routine, so a `PROCEDURE` was permanently blocking
and the printed remedy changed nothing. **Where to look:** every check in `supabase/core.sql` and
`supabase/tools/verify-schema.sql`. For each one, ask what it would do against an object of a kind
it was not thinking about. The negative controls in `harness/sql/nc*.sql` are the existing answer to
this — read them and ask what shape is *not* among them.

A concrete one nobody has attacked yet: `verify-schema.sql` still carries an
`expected_functions` array of **18 hand-listed names** (the "All 18 key functions exist" line). It
predates the manifest, it is not the authority any more, and nothing keeps the two in step —
`repair_config_maps` is in the manifest and not in that list. It cannot cause a false failure, but
ask whether it can cause a false *reassurance*.

**2. A static guard matching one spelling of a shape.** The overlay-scanner guard began as two
regexes and caught **one of ten** ways to write the bug. Rebuilt on the TypeScript AST, it was then
shown **nine more** forms that got past it. The path-key registry guard had the identical problem: a
regex requiring exactly two spaces of indentation, letters only, a literal colon and the literal
word `Record`. **Where to look:** `src/lib/metadata/overlayCallSites.test.ts`,
`src/stores/persistedPathKeys.test.ts`. Both are now type-rooted rather than name-rooted. Try to
write a tenth form. Note that `7aca01f` explicitly declines to add a guard for the
`configurationScopeProperties` inline form, and says why — that reasoning is worth attacking.

**3. A concept with two definitions, where the second quietly folds in a fallback.** `verified`
became reachable for values never written because a second definition of "a configuration's own
properties" resolved through the file-level bag underneath. A configuration that holds nothing of
its own reads back exactly like one that was written. **Where to look:** anywhere the codebase
distinguishes a configuration's *own* bag from the *resolved* view —
`src/lib/metadata/verifyWrite.ts`, `configurationMaps.ts`, `divergence.ts`, `configMapRepair.ts`.
Ask of each read: own, or resolved? and is that the one the caller meant?

**4. Success reported unconditionally because a result code was never read.** `stamp_schema_version`
returned `{"stamped": true}` when RLS had silently matched zero rows. "Sync Metadata" reported
success on a write that reached 12 of 68 configurations. The C# service reported "the API call
returned" as "the value is in the file". **Where to look:** every `success: true` in
`solidworks-service/` and in `src/lib/metadata/`, and every `ROW_COUNT` that is not checked in
`supabase/`.

**5. An agent's own tests passing because the thing under test was never reached.**
`check_org_gates()` called each function with `NULL` in every argument and accepted any exception as
evidence of a gate — so two purpose-built functions with no authorization at all scored `gated`. In
the harness, four share-link attacks hung off a token minted by an attack that had since been fixed,
so **three findings shipped with zero executed coverage**. **Where to look:** any test whose
assertion is "it threw" or "it refused". Ask what else could have produced that.

The schema-94 proof was written with this pattern in mind and is the model to hold others to: its
case 23 is a **sentinel** that deliberately fails if the merge under test is written backwards, so
the suite is known to be able to tell a working function from an inert one. Ask of any suite you
review: what would it do against a function that does nothing at all?

---

## 5. What changed, by area

### Database and schema (`supabase/`)

Schema **86 → 94** across this range. Every module was touched; `core.sql` is heavily rewritten;
there are two new tools, `supabase/tools/emergency-lockdown.sql` and
`supabase/tools/test-merge-custom-properties.sql`.

The security arc, in order, each release fixing the previous one's fix:

- **87** — `checkin_file` merges the per-configuration maps entry by entry. *The production bug.*
- **88** — `generate_rfq_number` recreated; it had been dropped when `schema.sql` was split into
  modules, so creating an RFQ failed on every correctly installed database.
- **89** — `SECURITY DEFINER` functions taking a `p_org_id` now prove membership; the schema version
  is written **only** by `verify-schema.sql`, after checking the release's objects exist.
- **90** — the `REVOKE ... FROM PUBLIC` v89 relied on removed nothing on Supabase, because the
  bootstrap grants `anon` explicitly. All 159 functions were callable without logging in.
- **91** — four cross-tenant holes v90 left, plus the reason v90 could never stamp at all.
  `parts_with_pricing` was readable with the publishable key and returned every organization's part
  numbers and prices. Nine membership tests written as `p_org_id NOT IN (SELECT org_id FROM users
  WHERE id = auth.uid())` evaluated to `NULL` for an account whose `org_id` is still `NULL`.
- **92** — makes verification winnable (advisory vs blocking), removes `uuid-ossp`,
  fixes `apply_workflow_transition` cross-tenant, makes `require_auth` on a share link mean "member
  of the file's organization", tightens three self-certifying checks.
- **93** (`c7faa60`) — closing a hole and revoking what the hole produced now travel together.
  Applying the schema deactivates cross-tenant share links and redacts `workflow_history` naming
  another organization's workflow, copying every row into `schema_remediation_log` first;
  `check_release_residue()` withholds the stamp while any remains. `consume_share_link` and
  `validate_share_link` both call one `share_link_admission()`. The upgrade lane was born here.
- **94** (`eb7aeb8`) — `repair_config_maps()`, below.

**Schema 94, the configuration-map repair.** The offline script that preceded it could prove it
never wrote by showing you its import list — no database client anywhere in its import graph. A
button cannot be defended that way, so rather than drop the guarantee it moved into SQL, where it
covers every caller there will ever be instead of one. Three properties are structural and none
depends on the argument: the merge is written `computed || existing` **in the function body** with
the row on the right, so the key set can only grow and no request can express an overwrite or a
deletion; the keys it writes come from a constant in the body rather than from the request, so a
request naming `part_number` is unseen rather than refused; and a map the row never had is not
created, because filling one would invent database state rather than restore it. Admin-only, with
`require_org_member` and `is_org_admin` checked independently, unreachable by `anon` [measured].

Its proof is `harness/sql/repair-config-maps-proof.sql`, moved there from the staging directory so
it lives beside the other verification SQL and can be re-run. **23 of 23 pass** against the landed
schema [measured] — re-run rather than trusted, because schema 93 had changed
`10-source-files.sql` underneath it.

The client is `src/lib/supabase/configMapRepair.ts`; its signature matches the function [measured].
It still handles `SQLSTATE 42883` as "not installed yet" rather than as a failure, and that path is
still needed, because production is on 85. The string it displayed said the function "ships with the
next schema release", which was true while it was staged and is not now; it names schema 94.

**Resolved, not deferred: the `onRepair` seam.** The previous revision recorded that
`VaultAuditFindings`'s `onRepair?: (target: VaultAuditRepairTarget) => void` — per-value,
synchronous, `void` — was structurally incompatible with a whole-vault offline SQL generator, and
warned against wiring them together. That was correct and it was resolved the right way: the seam
was **replaced** rather than bridged. `src/types/vaultAudit.ts` documents why at the point of
change — a write is asynchronous and has an outcome, and `void` cannot report whether the row was
found, was already intact, or how many entries landed.

### SolidWorks service and C#

The service went `1.12.0` → `1.21.0`. A whole test project is new:
`solidworks-service/BluePLM.SolidWorksService.Tests/`.

- **`6713ed9`, `20a6d93`, `7269dfb`** — attaching to the running SOLIDWORKS release rather than a
  guessed one; two wrong vendor constants; writes that reported success either way.
- **`2f13a14`, `90d9525`, `29474c2`** — the orphan watchdog force-killed any `SLDWORKS.exe` whose
  main window was titled `__wglDummyWindowFodder`, a scratch window OpenGL creates that says nothing
  about who owns the process. **A user lost an unsaved session to this on 6 August.** Ownership is
  now proven.
- **`afbd8b8`** — `RegressionFixtureGuard` could be talked into permitting a write to a production
  document three ways. All three reproduced on Windows first.
- **`c261c16`, `390be0b`, `bec2382`, `a9b0284`** — a failed drawing-reference read and a drawing with
  genuinely no references returned the same empty list. A drawing's configuration is now read from
  the view record rather than guessed.
- **`dbbcc4e`** — an empty value meant "delete the property" in **four** write paths. A title block
  reads `$PRP:"Description"` by name, so deleting breaks the link rather than blanking it.
- **`6c315e3`** — new command `getPropertiesDocumentManager`, so a vault-wide walk cannot route
  thousands of COM calls through the user's session. Unknown actions answer
  `errorCode: UNKNOWN_ACTION` rather than prose indistinguishable from an unreadable file.

### Electron main and renderer metadata

The largest area: 176 files under `src/`, 88 modified, ~90 new.

- **`098c64b`** — roughly thirty places each decided for themselves how to combine a pending edit
  with the server's value, five different ways, three of which could not distinguish "the user
  deleted this" from "the user has not touched this". There is now one overlay resolver.
- **`110c4c8`** — the in-memory copy of the server row is no longer written by an edit.
- **`f239aa6`, `7d959c0`** — a failed write keeps the value and marks it rather than discarding or
  silently promoting it; a rename no longer orphans the mark.
- **`10d4c5a`, `598f039`, `6f49d95`, `1f74ad2`** — check-in sends the complete configuration map with
  edits laid over it (**[reported]** 11.8s → 1.4s on the 68-configuration o-ring).
- **`e679541`** — a retitle on a multi-configuration part wrote into the configurations and not the
  document's own bag, then read it back and reported `verified`.
- **`049a704`, `73b80a1`** — the divergence scan is now **Settings → Organization → Vault Audit**,
  admin-only, gated twice.
- **`515892a`** — the repair UI: an admin can apply what the scan found, with the guarantee in SQL.

### API (`api/`)

`2.4.0` → `2.6.0`.

- **`255a2e4`** — the published API returned its own stack traces to unauthenticated callers, because
  `NODE_ENV !== 'production'` meant "developer laptop" and `api/Dockerfile` deliberately sets no
  `NODE_ENV`. One variable decided error detail, `/docs` and CORS; now three decisions.
- **`f139276`** — a request to `/extensions/{id}/{path}` was refused with 401 and then **carried out
  anyway**: the route authenticated inside a `try`/`catch` whose empty `catch` swallowed the throw
  meant to stop the request. Also: the rate limiter answered 429 as 500.
- **`0cb8337`** — the image ran `npx tsx api/server.ts`, fetching its TypeScript runtime from npm on
  every cold start. Compiling for real exposed **six imports Node could never have resolved**.
- **`29811c8`** — three share-link controls that enforced nothing were **removed** rather than left
  working-but-inert.

### CI and tooling

- **`adb8b10`, `3999440`, `a3546f7`** — `.github/workflows/ci.yml`. `npm ci`, `npm ci --prefix api`,
  `typecheck`, `typecheck:api`, `api:build`, `npm test`, on every PR and push to `main`, Node 22.
  Lint runs beside it and is **deliberately non-blocking** (`continue-on-error: true`).
- **`5883936`** — `electron/` had never been typechecked; the config omitted a language target, so
  `tsc` assumed ES5 and buried real findings. 14 of 26 complaints were fabrications; the remaining
  12 were genuine, including two `ReferenceError`s that made **every failed extension install**
  report `extensionId is not defined`.
- **`8808e12`** — the upgrade lane takes `-BaselineVersion`; the uuid census; the `absent` verdict.

---

## 6. What was actually executed, and what the numbers are

### Measured for this document, tonight

Every row here was run by this document's author against `HEAD` (`8808e12`).

| Check | Result |
|---|---|
| `npm run typecheck` | **clean** (renderer + electron) |
| `npm test` | **1,035 passed, 59 files**, 6.06s |
| `npm run test:sw-service` | **222 passed, 3 skipped, 225 total**, .NET Framework 4.8 |
| `npm run lint` | **713 problems: 181 errors, 532 warnings** (non-blocking) |
| Fresh install of schema 94 + `verify-schema.sql` | stamped **94**; 76 tables, RLS on all, anon sweep clean, 1 advisory |
| `harness/sql/repair-config-maps-proof.sql` | **23 of 23 PASS** |
| `repair_config_maps` ACL | `anon` EXECUTE **false**, `authenticated` **true**, `SECURITY DEFINER` **true** |
| Manifest check for `repair_config_maps(uuid,jsonb)` | **ok** |
| 70 vault fixtures, before/after the C# run | SHA-256 digest **identical**; `resources/bin/win32` unchanged |

**Upgrade lanes, all ending at schema 94:**

| Lane | uuid defaults | Extension droppable | 2nd run | Residue before | Attacks before → after | Stamp |
|---|---|---|---|---|---|---|
| **81 → 94** | 103 → 0 | no → **yes** | no-op | 1 share link, 0 history | 14 of 18 → **0 of 18** | 94 |
| **86 → 94** | 93 → 0 | no → **yes** | no-op | 1 share link, 1 history | 16 of 18 → **0 of 18** | 94 |
| **90 → 94** | 93 → 0 | no → **yes** | no-op | 1 share link, 1 history | 16 of 18 → **0 of 18** | 94 |

All three end with residue empty, all four posture checks passing, and the stamp equal to
`schema_release_version()`. On the 81 lane, attacks `F6a`, `F6b`, `F7a` and controls `C8`, `C11` are
reported **absent** rather than refused — the functions do not exist at 81. On the 86 lane, `F7a`
and `C11` are absent. **That is coverage the 81 and 86 lanes do not have and the 90 lane does**, and
it is the reason all three are reported rather than only the oldest.

For comparison, the previously recorded figure was *16 of 18 attacks succeed against v90, 0 of 18
after, stamped 93* — the 90 lane's numbers are unchanged by schema 94 except for the stamp.

### Reported, not re-run

**All [reported]**, from commit messages. Re-running any is a legitimate first move.

| Claim | Where it comes from |
|---|---|
| 940 tests, C# 220 passed / 3 skipped | `5b0708e` |
| 905 tests passed | `94ad072` |
| 795 tests, up from 632 | `f239aa6` |
| Clean-clone `node:22` container: `npm ci` 26s, typecheck 21s, 811 tests; actionlint clean | `adb8b10` |
| C# 200 passed / 3 skipped; 202 / 1 with large fixtures; Electron 49 passed | `29474c2` |
| API: 73 routes across 12 modules identical before and after the build change | `0cb8337` |
| 68-configuration write-and-confirm: 11.8s → 1.4s | `1f74ad2` |
| Production is on schema 85, applied 2026-07-31 | the owner |
| The wipe audit figures in §3 | external artifacts outside this repository |

---

## 7. Known gaps — the most important section

Be suspicious of everything here. These are the places where a claim is not backed by an execution.

1. **GitHub Actions now runs, and the correction is instructive.** The previous revision said *"No
   GitHub Actions run has ever executed"* and called checking it the cheapest high-value move
   available. It was, and it has happened. **[measured, `gh run list`]** there have been four runs:
   two `workflow_dispatch` runs on 2026-08-06 that **failed after ~15 minutes each**, one
   push-triggered run (`31128559550`) that **succeeded** — `Typecheck and Test` green in 1m42s, with
   only the non-blocking `Lint` job red — and the run triggered by tonight's push
   (`31142030689`), which **also passed**: `Typecheck and Test` green in 1m31s, `Lint` red and
   non-blocking. So the platform does agree with the container for typecheck and test, and
   `actions/checkout@v5`, `actions/setup-node@v5` and the two-lockfile cache key do behave as
   written. **What is still unexplained is the two 15-minute `workflow_dispatch` failures.** They
   are the remaining question here, not the workflow's basic viability.

2. **The CORS work was proven against an Electron harness, not a packaged installer.** Unchanged and
   still the largest untested claim in the release. The load-bearing finding is that a `file://`
   page's `fetch()` sends **no `Origin` header at all** under Electron 39.2.7, so the packaged app is
   not a CORS client and deny-by-default is safe. That was measured — but against a harness, not a
   built, signed, installed application. If it is wrong, Integrations, Customer Sync, Webhooks, the
   Suppliers view and the version check all go offline for every user simultaneously.

3. **The upgrade path is now tested from 81 and 86, but never from 85 itself, because 85 does not
   exist in git.** See §3. This is a real closure of the previous gap and an honest residue: the
   brackets are an argument that every *object* an 85 database can hold is covered by one lane or
   the other. They are not proof that production's particular *data* — nine releases of real
   history, real share links, real workflow rows — behaves like a freshly seeded harness database.
   The harness seeds two tenants and a few dozen rows; production has a vault of 8,015 models.
   **Nothing has been run against a copy of production.** If a restorable backup exists, running the
   lane against a restored copy is the single most valuable outstanding test in this document.

4. **`migrate_uuid_defaults()` is now measured at two different counts and both move.** Closed as a
   gap, with one residue: the census reports by `relkind`, and everything found so far has been
   `relkind = 'r'`, which is what the function reaches. A **partitioned** table carrying such a
   default would be counted by the census and missed by the function. There are none today in either
   baseline [measured], and the census will say so loudly if one appears.

5. **Intermediate commits were never individually typechecked.** Only tips. `eb7aeb8` and `8808e12`
   were both typechecked at the tip, and the full suite was run at `8808e12`; the 57 commits before
   them were not individually verified. Any given commit in the middle of the range may not compile.
   This matters if you plan to bisect, and it means the CI gate will only ever have an opinion about
   tips of branches, never about the commits inside them.

6. **Schema 94 has been applied to a harness database and to nothing else.** The fresh lane and all
   three upgrade lanes stamp 94, but no production or staging database has run it. The 23-case proof
   runs against seeded fixtures, not against the ~10 genuinely damaged files.

7. **The `absent` verdict added to `attack.ps1` is the one place a check was loosened today.** It is
   scoped to the baseline half of the upgrade lane and to `PGRST202` only, and after the upgrade a
   missing function is still a hard failure. But it is a rule that says "this failure does not
   count", and those deserve a second reader. `harness/attack.ps1`, `Test-ObjectAbsent`.

8. **Two share-link functions remain on the `anon` allowlist.** `validate_share_link(text)` and
   `consume_share_link(text)`, along with `get_org_auth_providers(text)` which the sign-in screen
   needs pre-login. The justification is that a share-link recipient is not a BluePLM user and the
   token is the credential, which is only defensible because the token is now 128 bits from the
   database's CSPRNG. Separately, `create_file_share_link`, `validate_share_link` and
   `consume_share_link` **have no caller anywhere in the application** — the controls that used them
   were removed in `29811c8`, and the functions were left in place with a **deferred cleanup task**
   noted for a later schema pass.

9. **The emergency lockdown script exists and the owner declined to run it.** A deliberate decision,
   not an oversight: small organization, longstanding exposure, weighed and accepted. Do not report
   this as a finding; do factor it into how you weight anything that depends on production being
   closed.

10. **`npm run lint` is red and getting redder.** **181 errors, 532 warnings, 713 problems**
    [measured] against the 136 / 539 recorded previously. The job is `continue-on-error: true` and
    was intended to start blocking at zero. It is moving the wrong way, and nothing is watching the
    number.

11. **`package.json` is still `3.24.0`** while the changelog heads `3.25.0 - Unreleased`, and there
    is no `v3.24.0` tag. The release gate in `.cursor/rules/always.mdc` requires the bump before
    tagging. No tag was created tonight, so nothing is violated yet.

12. **Extension `public: true` endpoints are documented and have never worked**, and are now
    explicitly **not** honoured. Serving an anonymous caller means choosing an organization without a
    credential, and the header that used to answer that is exactly the hole `f139276` closed.

13. **`configurationRecordedOnly`, the default Vault Audit scope, has a stated blind spot:** a
    multi-configuration file whose row never carried a configuration map is skipped entirely. The
    argument is that such a file can only have produced no-evidence and unattributed values anyway —
    and schema 94 makes the same judgement structural, by refusing to create a map that does not
    already exist. Both rest on the same premise. If that premise is wrong, it is wrong in two
    places at once, which is exactly the "one concept, two definitions" pattern in §4.3.

---

## 8. Suggested split for parallel review

| Reviewer | Start at | First question |
|---|---|---|
| A — CI | `.github/workflows/ci.yml`, `gh run view 31126483600` | Why did the two `workflow_dispatch` runs fail after 15 minutes when the push-triggered run passed in under two? |
| B — schema | `supabase/tools/verify-schema.sql`, `harness/sql/nc*.sql` | What object kind is still not covered by a sweep or a control? Start with the stale 18-name `expected_functions` list. |
| C — upgrade path | `harness/upgrade.ps1`, `harness/attack.ps1` | Attack the `absent` verdict. Can a genuinely missing function reach production through it? Then: is there a restorable production backup to run the lane against? |
| D — metadata | `src/lib/metadata/`, `overlayCallSites.test.ts` | Write a tenth form the AST guard misses. Find a length comparison that should be a name comparison. |
| E — service | `solidworks-service/` | Find a `success` that is the API's return value rather than the file's state. |
| F — API | `api/src/core/plugins/errorHandler.ts`, `api/src/extensions/router.ts` | Is there a second route that authenticates itself rather than through the guard? |
| G — repair | `supabase/modules/10-source-files.sql` (`repair_config_maps`), `harness/sql/repair-config-maps-proof.sql` | The proof has a sentinel, so it is not vacuous. Now find the case it does not have. |

Reviewers C and D must not run against `C:\BluePLM\br-vault` or against the production database.
`supabase/` and `harness/` are writable again — the other agent has finished — but the vault and the
service binary are not.

---

## 9. What the owner runs against production, in order

Nothing below has been run against production. This is the sequence the release implies, and it is
here so the review has something concrete to disagree with.

1. **`supabase/tools/emergency-lockdown.sql`** — optional, and declined so far. It needs nothing
   applied first, changes no table and no function body, is safe to run twice, and closes the
   anon-reachability hole immediately rather than at upgrade time.
2. **`supabase/core.sql`**.
3. **Every module installed, in numeric order** — `10-source-files`, `15-inspection`, then whichever
   of `20`, `30`, `40`, `50`, `60` the organization uses. Applying `10-source-files.sql` performs the
   remediations and prints the rows it acted on; on the owner's database, expect the cross-tenant
   share-link and `workflow_history` remediations to report **0** unless production has damage the
   harness does not model.
4. **`supabase/tools/verify-schema.sql`** — not optional, and the only thing that writes the version.
   Until it runs, BluePLM will correctly report that the database is older than the app. Expect
   `Schema verified and stamped at version 94`, and expect one **advisory** item about a
   default-privilege entry owned by `supabase_admin`, which is real, unfixable by the project's
   `postgres` role, and does not withhold the stamp.

Expect step 3 to move roughly **103** column defaults off `uuid_generate_v4()` if production is on
85 with the never-wired workflow tables still present, and 93 if they are not. The number is printed.
After that the `uuid-ossp` extension is droppable, though nothing drops it automatically.

Only after step 4 does the Vault Audit repair button appear; before it, the app reads
`SQLSTATE 42883` and says the repair is not installed, which is the correct answer.
