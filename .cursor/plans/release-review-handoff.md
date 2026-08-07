# Release review handoff: `v3.23.0` → `HEAD`

Written 2026-08-06 for an independent reviewer with no context from the day's work. Everything below
was derived from the repository — `git log`, the diffs, `CHANGELOG.md`, `.cursor/plans/`, and the
version files. Where a claim comes from a commit message or from the owner rather than from
something this document's author executed, it is marked **[reported]**. Treat those as the first
things to check.

The goal is an adversarial review. A defect you find because this document pointed you at a weak
spot is the success case, not an embarrassment.

---

## 1. Orientation: what BluePLM is

BluePLM is a desktop product-lifecycle-management application for engineering teams working in
SOLIDWORKS. It manages a *vault* — a folder tree of SOLIDWORKS documents on disk — plus a database
of item numbers, revisions, descriptions, workflows, RFQs, ECOs and customer data. Four processes:

| Part | Lives in | What it is |
|---|---|---|
| Renderer | `src/` | React + TypeScript + Zustand + Tailwind. The UI, and most business logic. |
| Electron main | `electron/` | IPC handlers, file system, watcher, SOLIDWORKS process lifecycle, extension host. |
| SOLIDWORKS service | `solidworks-service/` | A C# (.NET) stdin/stdout process. The only thing that touches SOLIDWORKS, via COM and the standalone Document Manager library. Versioned separately (`1.21.0`). |
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
and privilege layout so the schema can be attacked:

```powershell
cd harness
.\reset.ps1                       # rebuild, install schema, seed, start PostgREST
.\attack.ps1 -Expect fixed        # the attack suite
.\negative-controls.ps1           # reintroduce each hole; the verifier must catch it
.\upgrade.ps1                     # apply the release over a damaged v90 baseline (untracked, see §7)
```

**Do not modify `supabase/` or `harness/`.** Another agent is writing schema 93 in those directories
right now; both are dirty in the working tree and will change under you. Read only.

**Do not touch the vault at `C:\BluePLM\br-vault`.** The owner has SOLIDWORKS open on it.

---

## 2. Exact state of the tree

Verified at the time of writing:

- **52 commits** in `v3.23.0..HEAD`, 339 files changed, +44,440 / −4,484.
- Branch `main` is **ahead of `origin/main` by 6 code commits** (`8e794f5`, `6c315e3`, `049a704`,
  `73b80a1`, `cf3684d`, `7aca01f`), nothing behind. You will see seven: the commit adding this
  document is the seventh, and it touches nothing but this file.
- **Correction to what you may be told:** `origin/main` points at `255a2e4` (2026-08-06 14:39). The
  other **46 commits of today's work have already been pushed.** Only the last six are local. If a
  brief tells you "nothing has been pushed", it is wrong about the git remote; it is right about the
  *database*, which is the claim that actually matters.
- **No `v3.24.0` tag exists.** `v3.23.0` (`0fa2d3a`, 2026-07-31) is the newest tag. There is a
  `chore: Release v3.24.0` commit and a dated `3.24.0` changelog section, but no tag, so the review
  range in the title is the right one.

### Working tree is dirty

| Path | State |
|---|---|
| `supabase/core.sql` | modified, +494 / −38 — schema 93 in progress |
| `harness/docker-compose.yml`, `harness/install.ps1`, `harness/reset.ps1` | modified |
| `harness/sql/residue-report.sql`, `harness/upgrade.ps1` | untracked |

Committed `core.sql` declares `schema_release_version() = 92`. The **working tree** declares `93`.
`src/lib/schemaVersion.ts` declares `EXPECTED_SCHEMA_VERSION = 92`. So as you read, the working tree
is internally inconsistent by design — that is the other agent mid-flight, not a defect. Review the
committed tree unless you are specifically reviewing schema 93.

### Version files

| File | At `v3.23.0` | At `HEAD` |
|---|---|---|
| `package.json` | `3.23.0` | `3.24.0` |
| `src/lib/schemaVersion.ts` `EXPECTED_SCHEMA_VERSION` | `86` | `92` |
| `src/lib/swServiceVersion.ts` `EXPECTED_SW_SERVICE_VERSION` | `1.12.0` | `1.21.0` |
| `api/package.json` | `2.4.0` | `2.6.0` |
| `src/lib/apiVersion.ts` `EXPECTED_API_VERSION` | — | `2.6.0` |

Two notes. `api/src/lib/apiVersion.ts` **does not exist**; the app-side constant is
`src/lib/apiVersion.ts` and the API-side number is the `version` field of `api/package.json`. And
`package.json` still reads `3.24.0` while `CHANGELOG.md` heads its top section
`## [3.25.0] - Unreleased` — the app version has not been bumped for this release. Per
`.cursor/rules/always.mdc` the release gate requires that bump before a tag; it has not happened.

---

## 3. Production state — read this before you evaluate any schema claim

**The owner's production database is on schema 85, applied 2026-07-31.** **[reported]** Nothing
from today has been applied to it.

The changelog describes schemas 87 through 92 (and the working tree is drafting 93). Every one of
those entries describes code that **is not running anywhere**. When the changelog says a hole is
closed, read it as "closed in a file"; production is seven schema releases behind that file. This
cuts both ways for your review: the security fixes are unproven in production, and so are any
regressions they might carry.

### The live bug still running in production

`checkin_file` merged the reserved per-configuration maps in `files.custom_properties` with
`jsonb ||`. That operator is a **top-level** merge: it replaces a nested object rather than merging
into it. Check-in sent only the configurations edited during that checkout, so
`custom_properties._config_tabs` and `._config_descriptions` were replaced with whatever that one
session had touched. Silent, on the success path.

Fixed in **schema 87** — therefore **not fixed in production**. It is still happening on every
check-in the owner performs.

Measured damage **[reported, from an external audit — artifacts at
`C:\Users\emill\Documents\blueplm-wipe-audit\`, outside this repository]**:

- `ORING-BUNA-70A.SLDPRT` — **1 entry of 68 configurations** in each map.
- `ORING-SILICONE-50A` — **1 of 5**.
- `ORING-FKM-75A` — **intact**: 26 entries against 15 configurations, 11 of them stale keys for
  configurations that have since been deleted.
- A vault-wide query found **zero present-but-empty maps**, so no file lost everything.
- **Roughly ten files** have meaningful loss.

The values were not destroyed. The wipe took the database's copy; the SOLIDWORKS documents still
hold them. That is what makes repair possible at all (§5, "database and schema").

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

These are not theoretical. Each is a pattern that produced a real defect today, and each recurred
more than once. Look for the *next* instance of each.

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

**2. A static guard matching one spelling of a shape.** The overlay-scanner guard began as two
regexes and caught **one of ten** ways to write the bug. Rebuilt on the TypeScript AST, it was then
shown **nine more** forms that got past it: a parameter destructured under another name, array
destructuring, the row carried on an object property, the row returned from a helper,
`file['pdmData']`, a computed field name, a reassignment rather than a declaration, and a row that
never passes through a name like `pdmData` at all. The path-key registry guard had the identical
problem: a regex requiring exactly two spaces of indentation, letters only, a literal colon and the
literal word `Record`. **Where to look:** `src/lib/metadata/overlayCallSites.test.ts`,
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
success on a write that reached 12 of 68 configurations. A batch write named a configuration it had
failed to enter, in prose, while returning overall success. The C# service reported "the API call
returned" as "the value is in the file". **Where to look:** every `success: true` in
`solidworks-service/` and in `src/lib/metadata/`, and every `ROW_COUNT` that is not checked in
`supabase/`.

**5. An agent's own tests passing because the thing under test was never reached.**
`check_org_gates()` called each function with `NULL` in every argument and accepted any exception as
evidence of a gate — so a function that validates a different argument first was certified without
its gate ever executing, and two purpose-built functions with no authorization at all scored
`gated`. In the harness, four share-link attacks hung off a token minted by an attack that had since
been fixed, so **three findings shipped with zero executed coverage**. **Where to look:** any test
whose assertion is "it threw" or "it refused". Ask what else could have produced that.

---

## 5. What changed, by area

### SolidWorks service and C#

The service went `1.12.0` → `1.21.0`. A whole test project is new:
`solidworks-service/BluePLM.SolidWorksService.Tests/` (19 files).

- **`6713ed9`, `20a6d93`, `7269dfb`** — attaching to the running SOLIDWORKS release rather than a
  guessed one; two wrong vendor constants; writes that reported success either way. `SwDmConstants.cs`
  and its test are new.
- **`2f13a14`, `90d9525`, `29474c2`** — the orphan watchdog force-killed any `SLDWORKS.exe` whose
  main window was titled `__wglDummyWindowFodder`, which is a scratch window OpenGL creates and says
  nothing about who owns the process. **A user lost an unsaved session to this on 6 August.**
  Ownership is now proven (`LaunchedProcess.cs`, `electron/handlers/swProcess/*`). The origin gate
  and the probe's read-only promise were also made provable.
- **`afbd8b8`** — `RegressionFixtureGuard` could be talked into permitting a write to a production
  document three ways: a junction standing in for the fixture folder itself, a relative path
  resolved against the working directory, and one more. All three reproduced on Windows first.
- **`c261c16`, `390be0b`, `bec2382`, `a9b0284`** — a drawing reference read that failed and a
  drawing with genuinely no references returned the same empty list, so BluePLM escalated to opening
  the file in SOLIDWORKS. Now distinct answers, with a Document-Manager route
  (`DocumentManagerAPI.References.cs`). A drawing's configuration is now read from the view record
  rather than guessed as `default` / `standard` / first — the guess put `BR-100635-XXX` on all 11
  drawings of the 68-configuration o-ring.
- **`dbbcc4e`** — an empty value meant "delete the property" in **four** write paths. A title block
  reads `$PRP:"Description"` by name, so deleting breaks the link rather than blanking it. All four
  now write the empty value through; deletion is explicit.
- **`6c315e3`** (unpushed) — new command `getPropertiesDocumentManager`, resolving straight to
  `DocumentManagerAPI.GetCustomProperties` with no `IsFileOpenInSolidWorks` probe, so a vault-wide
  walk cannot route thousands of COM calls through the user's session. Service bumped to `1.21.0`.
  Unknown actions now answer `errorCode: UNKNOWN_ACTION` rather than prose indistinguishable from an
  unreadable file. A feature-specific floor, `SW_SERVICE_VERSION_DOCUMENT_MANAGER_READ`, gates the
  audit separately from the app-wide version check.

**Reported figures [reported, from commit messages — not re-run here]:** `29474c2` — C# 200 passed
/ 3 skipped, 202 / 1 with `BLUEPLM_REGRESSION_LARGE_FIXTURES=1`, Electron 49 passed, all 70 fixtures
byte-identical and still read-only afterwards. `5b0708e` — C# 220 passed / 3 skipped.

### Electron main and renderer metadata

This is the largest area: 176 files under `src/`, 88 of them modified, plus ~90 new.

- **`098c64b`, `126`-series changelog entries** — roughly thirty places each decided for themselves
  how to combine a pending edit with the server's value, five different ways, three of which could
  not distinguish "the user deleted this" from "the user has not touched this". There is now one
  overlay resolver (`src/lib/metadata/overlay.ts`).
- **`110c4c8`** — the in-memory copy of the server row is no longer written by an edit. This is what
  surfaced the remaining stale-value sites (exports, command palette, RFQ picker, inspection sheet,
  Item Browser, reference diagnostics).
- **`f239aa6`, `7d959c0`, `119`-series** — the write-state machine: a failed write keeps the value
  and marks it rather than discarding or silently promoting it; a rename no longer orphans the mark.
- **`10d4c5a`, `598f039`, `6f49d95`, `1f74ad2`** — check-in sends the complete configuration map with
  edits laid over it; "Sync Metadata" no longer strips every configuration tab; a verified write
  batches its configurations into one call (**[reported]** 11.8s → 1.4s on the 68-configuration
  o-ring, 275 properties).
- **`e679541`** — a retitle on a multi-configuration part wrote into the configurations and not the
  document's own bag, then read it back from the configuration and reported `verified`.
- **`0a1a40e`, `d09699c`** — the divergence scan called values recoverable that BluePLM never owned.
- **`049a704`, `73b80a1`** (unpushed) — the divergence scan is now **Settings → Organization → Vault
  Audit**, admin-only, gated twice. The run lives in the store so a panel unmount does not kill it;
  only the scope preference is persisted, never the report.
- **`5b0708e`, `7aca01f`** (last unpushed) — both static guards rebuilt on the type checker; the
  missing-command refusal translated; `configMapRepair.ts` reads the scope view through the shared
  rule rather than restating it inline.

**Reported figures [reported]:** `f239aa6` — 795 tests, up from 632. `94ad072` — 905 passed,
typecheck clean. `5b0708e` — 940 tests, typecheck clean. Nothing was run to produce this document.

### Database and schema (`supabase/`) — READ ONLY

Schema **86 → 92** across this range, with **93 uncommitted in the working tree**. Every module was
touched, `core.sql` is +2,066 / −49, `verify-schema.sql` is +250 / −14, and there are two new tools:
`supabase/tools/emergency-lockdown.sql` (413 lines) and
`supabase/tools/test-merge-custom-properties.sql` (269 lines).

The security arc, in order, each release fixing the previous one's fix:

- **87** — `checkin_file` merges the per-configuration maps entry by entry. *The production bug.*
- **88** — `generate_rfq_number` recreated; it had been dropped when `schema.sql` was split into
  modules, so creating an RFQ failed on every correctly installed database.
- **89** — `SECURITY DEFINER` functions taking a `p_org_id` now prove membership; the schema version
  is written **only** by `verify-schema.sql`, after checking the release's objects exist.
- **90** — the `REVOKE ... FROM PUBLIC` v89 relied on removed nothing on Supabase, because the
  bootstrap grants `anon` explicitly. All 159 functions were callable without logging in. Functions
  reaching an org through an *entity* id were gated. Verification became blocking.
- **91** — four cross-tenant holes v90 left, plus the reason v90 could never stamp at all.
  `parts_with_pricing` was readable with the publishable key and returned every organization's part
  numbers and prices — a view has no RLS of its own and this one was not `security_invoker`. Nine
  membership tests written as `p_org_id NOT IN (SELECT org_id FROM users WHERE id = auth.uid())`
  evaluated to `NULL` for an account whose `org_id` is still `NULL`.
- **92** — makes verification winnable (advisory vs blocking), removes `uuid-ossp` entirely
  (93 defaults moved to `gen_random_uuid()`), fixes `apply_workflow_transition` cross-tenant,
  makes `require_auth` on a share link mean "member of the file's organization", and tightens the
  three self-certifying checks described in §4.

**Configuration-map repair.** `cf3684d` adds `npm run repair:config-maps` — a standalone script, not
an app command, deliberately. There is **no database client in its import graph**, so it cannot
apply anything; the most it produces is a `.sql` file, and only when `--emit-sql` names a path. Its
document side comes from a read-only census NDJSON, so it never opens the vault. Every emitted
statement is `computed || existing` with the live row on the right, read at apply time, so an
existing entry wins on every shared key and a stale plan degrades to a smaller repair. No `DELETE`,
no `jsonb - key`. Supporting SQL in `tools/config-map-repair/`. Logic and tests in
`src/lib/metadata/configMapRepair*.ts`.

### API (`api/`)

`2.4.0` → `2.6.0`. Twenty files.

- **`255a2e4`** — the published API returned its own stack traces to unauthenticated callers,
  because `NODE_ENV !== 'production'` meant "developer laptop" and `api/Dockerfile` deliberately
  sets no `NODE_ENV`. One variable decided error detail, `/docs` and CORS; now three decisions.
  `NODE_ENV` defaults to `production`. `CORS_ORIGINS` **adds** to an allowlist that permanently
  contains the desktop app, rather than replacing it. `CORS_ORIGINS=*` — which `render.yaml` shipped
  — is ignored with a warning rather than refused.
- **`f139276`** — a request to `/extensions/{id}/{path}` was refused with 401 and then **carried out
  anyway**: the route authenticated inside a `try`/`catch` whose empty `catch` swallowed the throw
  that was meant to stop the request. Everything after ran with the org read from a caller-supplied
  `X-Org-Id` header and a database client built from the publishable key. Also: the rate limiter
  answered 429 as 500, because its `errorResponseBuilder` returned a plain object with no
  `statusCode`, so the documented `RATE_LIMIT_EXCEEDED` code was unreachable.
- **`0cb8337`** — the image ran `npx tsx api/server.ts`, fetching its TypeScript runtime from npm on
  every cold start; with `--network none` the container never listened. Now a two-stage build
  compiling with `tsc`. Compiling for real exposed **six imports Node could never have resolved** —
  `moduleResolution: bundler` had permitted extensionless relative specifiers, including a bare
  directory. `typecheck:api` runs with `noEmit` and had passed all six for years.
- **`29811c8`** — three share-link controls that enforced nothing were **removed** rather than left
  working-but-inert: `revokeShareLink()` (set `is_active = false` on a row that gates no access, so
  the signed URL kept working), `--max-downloads`, and the sign-in requirement. A share link is a
  Supabase Storage signed URL handed straight to the recipient; only expiry is enforced, by Storage.

### CI and tooling

- **`adb8b10`, `3999440`, `a3546f7`** — `.github/workflows/ci.yml` is new. It runs `npm ci`,
  `npm ci --prefix api`, `typecheck`, `typecheck:api`, `api:build` and `npm test` on every pull
  request and every push to `main`, on Node 22. `release.yml` and `deploy-docs.yml` moved from Node
  20 to 22. Lint runs beside it and is **deliberately non-blocking** (`continue-on-error: true`) —
  `npm run lint` currently reports 136 errors and 539 warnings across 172 files, all pre-existing.
- **`5883936`** — `electron/` had never been typechecked. The config that covered it omitted a
  language target, so `tsc` assumed ES5 and buried real findings under complaints about iterating a
  `Map`. Fixing the target cleared 14 of 26 complaints as fabrications; the remaining 12 were
  genuine, including two `ReferenceError`s that made **every failed extension install** report
  `extensionId is not defined`.
- **`0fec1e0`** — `supabase/tools/emergency-lockdown.sql`, a paste-into-the-SQL-editor mitigation
  that revokes `anon` by name ahead of any schema upgrade.
- New harness: 54 files under `harness/`, including committed evidence transcripts in
  `harness/evidence/`.

---

## 6. What was actually executed, and what the numbers are

Nothing in this section was run to produce this document. These are the figures the commit messages
record. **All [reported].** Re-running any of them is a legitimate first move.

| Claim | Where it comes from |
|---|---|
| 940 tests, typecheck clean, C# 220 passed / 3 skipped | `5b0708e` commit message |
| 905 tests passed, typecheck clean, `test-merge-custom-properties` 26 cases + sentinel | `94ad072` |
| 795 tests, up from 632 | `f239aa6` |
| Clean-clone `node:22` container: `npm ci` 26s, typecheck 21s, 46 files / 811 tests; actionlint clean | `adb8b10`, verified against commit `29474c2` |
| C# 200 passed / 3 skipped; 202 / 1 with large fixtures; Electron 49 passed; 70 fixtures byte-identical | `29474c2` |
| 16 of 17 attacks succeed against v90, 0 of 17 after; 0 of 11 positive controls broken | `8e794f5` |
| API: 73 routes across 12 modules identical before and after the build change; 11 helmet headers present | `0cb8337` |
| 68-configuration write-and-confirm: 11.8s → 1.4s | `1f74ad2` / `writeMetadataToFile.ts` header |

---

## 7. Known gaps — the most important section

Be suspicious of everything here. These are the places where a claim is not backed by an execution.

1. **No GitHub Actions run has ever executed.** The CI gate in `ci.yml` was added while GitHub
   Actions was in a major outage, so the push that added it produced no run — `3999440` adds
   `workflow_dispatch` specifically so it can be triggered by hand, and that has not happened
   either. The commands were verified inside a `node:22` container from a clean clone; **the
   platform has never run the workflow.** Nothing has confirmed that `actions/checkout@v5`,
   `actions/setup-node@v5`, the two-lockfile cache key, or the concurrency expression behave as
   written. This is the cheapest high-value check available to you.

2. **The CORS work was proven against an Electron harness, not a packaged installer.** The load-
   bearing finding is that a `file://` page's `fetch()` sends **no `Origin` header at all** under
   Electron 39.2.7, so the packaged app is not a CORS client and deny-by-default is safe. That was
   measured — but against a harness, not against a built, signed, installed application. If it is
   wrong, Integrations, Customer Sync, Webhooks, the Suppliers view and the version check all go
   offline for every user simultaneously.

3. **The database upgrade path was proven from v90 → v92. Production is on 85.** `harness/upgrade.ps1`
   (untracked, in the working tree) exists because every release up to and including 92 had only ever
   been verified against a *fresh install*, and a fresh install has no history for a fix to fail to
   undo. Running the v90 → v92 lane found that **one of seventeen attacks still succeeded after the
   upgrade** — a cross-tenant share link that still answered `is_valid: true` to `anon` and still
   spent downloads — and `verify_and_stamp_schema()` returned `stamped: true` over it. The fresh lane
   reported zero. **No lane exists for 85 → 92 or 85 → 93,** which is the only path the owner's
   database will actually take. Five schema releases of drift are untested end to end.

4. **`migrate_uuid_defaults()` has only ever run against the exact 93 uuid defaults a v90 database
   happens to have.** It rewrites `DEFAULT uuid_generate_v4()` to `gen_random_uuid()`. It is narrow
   by design — only defaults that are exactly a no-argument call, only ordinary tables in `public` —
   but a v85 database, or one with a hand-added column, presents a different set. Nothing has
   measured what that set looks like.

5. **Intermediate commits were never individually typechecked.** Only the final tree was, after
   `6c315e3`, `049a704`, `73b80a1`, `cf3684d`. Any given commit in the middle of the range may not
   compile. This matters if you plan to bisect, and it means the CI gate — once it runs — will only
   ever have an opinion about tips.

6. **Schema 92 was reviewed and cleared "apply with caveats"; schema 93 is being written now** to
   close those caveats. **[reported]** — what this document's author can verify is that the working
   tree's `core.sql` declares `93` while the committed one declares `92`, and that `93`'s description
   concerns deactivating share links that grant cross-organization access when a release is applied.
   **Check `git log` and `git status` yourself when you start; describe the state you find.**

7. **The Vault Audit page's `onRepair` seam and the configuration-map repair tool are incompatible
   designs.** `VaultAuditFindings` exposes an optional `onRepair?: (target: VaultAuditRepairTarget)
   => void` — a **per-value, synchronous handler over five fields**. The repair tool is a
   **whole-vault, offline SQL generator over two fields** that structurally cannot write, by
   deliberate design (no database client in its import graph). Neither can be adapted to the other
   without abandoning what makes it safe. Today the seam is unwired: no caller passes `onRepair`, the
   button is disabled, and the tooltip says so honestly
   (`vaultAudit.findings.repairUnavailable`). This is **documented as a decision the owner must
   make**, not as a defect. Do not "fix" it by wiring them together.

8. **Two share-link functions remain on the `anon` allowlist.** `validate_share_link(text)` and
   `consume_share_link(text)` — along with `get_org_auth_providers(text)`, which the sign-in screen
   needs pre-login. The justification is that a share-link recipient is not a BluePLM user and the
   token is the credential, which is only defensible because the token is now 128 bits from the
   database's CSPRNG. Separately, `create_file_share_link`, `validate_share_link` and
   `consume_share_link` **have no caller anywhere in the application** — the controls that used them
   were removed in `29811c8`, and the functions were left in place with a **deferred cleanup task**
   noted for a later schema pass.

9. **The emergency lockdown script exists and the owner declined to run it.** This is a deliberate
   decision, not an oversight: small organization, longstanding exposure, weighed and accepted. The
   changelog's top line urges running it. It has not been run. Do not report this as a finding; do
   factor it into how you weight anything that depends on production being closed.

10. **`npm run lint` is red and non-blocking.** 136 errors, 539 warnings, 172 files, all pre-existing.
    The lint job is `continue-on-error: true` and is intended to start blocking at zero.

11. **`package.json` is still `3.24.0`** while the changelog heads `3.25.0 - Unreleased`, and there is
    no `v3.24.0` tag. The release gate in `.cursor/rules/always.mdc` requires the bump before tagging.

12. **Extension `public: true` endpoints are documented and have never worked**, and are now
    explicitly **not** honoured. Left as a stated gap because serving an anonymous caller means
    choosing an organization without a credential, and the header that used to answer that is
    exactly the hole `f139276` closed. A safe version needs an unguessable per-installation URL,
    which is a schema change.

13. **`configurationRecordedOnly`, the default Vault Audit scope, has a stated blind spot:** a
    multi-configuration file whose row never carried a configuration map is skipped entirely. The
    argument is that such a file can only have produced no-evidence and unattributed values anyway.
    That argument is worth attacking.

---

## 8. Suggested split for parallel review

| Reviewer | Start at | First question |
|---|---|---|
| A — CI | `.github/workflows/ci.yml` | Trigger it via `workflow_dispatch`. Does the platform agree with the container? |
| B — schema | `supabase/tools/verify-schema.sql`, `harness/sql/nc*.sql` | What object kind is still not covered by a sweep or a control? |
| C — upgrade path | `harness/upgrade.ps1` | Build an 85 → 92 lane. What survives that a 90 → 92 lane does not see? |
| D — metadata | `src/lib/metadata/`, `overlayCallSites.test.ts` | Write a tenth form the AST guard misses. Find a length comparison that should be a name comparison. |
| E — service | `solidworks-service/` | Find a `success` that is the API's return value rather than the file's state. |
| F — API | `api/src/core/plugins/errorHandler.ts`, `api/src/extensions/router.ts` | Is there a second route that authenticates itself rather than through the guard? |

Reviewers C and D should not run against `C:\BluePLM\br-vault` or against the production database.
Reviewers B and C must treat `supabase/` and `harness/` as read-only while schema 93 is in progress.
