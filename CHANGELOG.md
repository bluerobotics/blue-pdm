# Changelog

All notable changes to BluePLM will be documented in this file.

![1774273238438](image/CHANGELOG/1774273238438.png)

## [3.25.0] - Unreleased

> **Your database is reachable without a password right now. Paste `supabase/tools/emergency-lockdown.sql` into the Supabase SQL editor before you read any further.** It takes a few seconds, needs nothing else applied first, changes no table and no function body, and is safe to run twice. It closes the hole described in the first entry below. Everything else here can wait for a convenient evening; that cannot. **If you ran an earlier copy of that file, run it again**: that copy looked at functions and tables and not at views, and `parts_with_pricing` was serving every organization's parts and prices to anyone with the publishable key. This one covers views and materialized views as well.

> **Database schema 93, and the way you apply it has changed.** Run, in this order: `supabase/core.sql`, then every module you have installed in numeric order (`10-source-files`, `15-inspection`, then any of `20`, `30`, `40`, `50`, `60` you use), then **`supabase/tools/verify-schema.sql`**. That last file is new to the routine and is not optional: it is now the only thing that records the schema version, and it records it only after checking that the objects this release requires are actually in the database. Until you run it BluePLM will keep reporting that your database is older than the app, which is the correct answer for a database whose upgrade has not been confirmed. Re-running one module on its own no longer advances the version and will no longer work at all against an older `core.sql` — see below for why that is the fix rather than a regression.

> **Applying schema 93 will change data as well as objects, and it will tell you exactly what it changed.** Two of the holes earlier releases closed handed something out while they were open, and closing a hole does not take back what it produced. Applying `10-source-files.sql` now deactivates any share link pointing at a file in an organization other than the one the link was minted for, and redacts any `workflow_history` row that names another organization's workflow, state or transition. Every row is copied verbatim into a new `schema_remediation_log` table first, nothing is deleted, and both actions print how many rows they touched and which ones. On a database that never had these problems both report `0` and the log stays empty. `verify-schema.sql` then refuses to stamp for as long as any such row is still live, so a remediation cannot be skipped and then forgotten.

> **Verification may print an advisory item and stamp anyway. That is the correct outcome, not a partial failure.** An advisory is something real that your project's `postgres` role is not permitted to change — on Supabase, the default-privilege entry owned by `supabase_admin`, and any function `CREATE EXTENSION` put in `public` under that owner. It is listed in full, by name, every run. What separates it from a blocking item is only who is allowed to fix it: anything you *can* fix still withholds the stamp until you do. A verifier that refuses for a condition you cannot clear is not stricter, it is broken, and that is what the previous two releases each did in a different place.

### Security
- **Every release until this one was tested only on a database with no history, and on the upgrade path a fix left the hole's output working** — installing schema 90, attacking it, and then applying 92 over the same database is what the owner's database actually does, and nobody had ever done it. Doing it leaves a share link that one organization's member minted against another organization's file still answering `is_valid: true` to an unauthenticated caller, still returning the victim's file id and organization id, and still spending downloads — and `verify_and_stamp_schema()` reports the schema clean over it. It survives *because* of the fix: v92 made `validate_share_link` resolve the organization from the file instead of trusting the link, and the file genuinely is in that organization, so the link now reads as a correct one. A fresh install cannot show this, because a fresh install has no history for a fix to fail to undo. **Two things changed.** Applying the schema now revokes what the closed holes produced, in the same file that closes them: cross-tenant share links are deactivated, `workflow_history` rows naming another tenant's workflow are redacted, both are idempotent, both print the rows they acted on by name, and both copy every row verbatim into `schema_remediation_log` before touching it, so nothing an audit might want is destroyed. The history rows are *redacted rather than deleted* deliberately — the disclosure already happened and deleting the evidence undoes none of it, while leaving the names in place lets it keep happening every time the page is opened. `check_release_residue()` withholds the stamp while any such row is live, which is the durable half: a release that closes a hole and forgets its output can no longer be stamped. And the harness gained a second lane, `harness/upgrade.ps1`, which installs the previous release, runs the full attack suite so the database carries real damage, applies the release under test in place with no teardown, and re-runs everything. A release now has to pass both lanes. On this one: 16 of 18 attacks succeed against v90, the residue report shows one live cross-tenant link and one disclosing history row, and after the upgrade 0 of 18 attacks succeed, the residue report is empty, and verification stamps 93.
- **`consume_share_link` spent a download on a file `validate_share_link` refused** — with `require_auth = false` and the file soft-deleted after the link was minted, validation answered `is_valid: false, "Link not found"` while consumption answered `true` and incremented the counter. The `deleted_at IS NULL` test existed in only one of the two functions and, in that one, only inside the `require_auth` branch. **Both functions now call a single `share_link_admission()` and neither restates a condition**, because two hand-written lists of conditions that must agree will not stay in agreement — the previous release tried to hold them together by requiring the same words in both and that is exactly what passed while they disagreed. The posture check that was supposed to catch it compared the two on `require_auth` alone; it now walks a matrix of link states (good, expired, deactivated, allowance exhausted, file deleted, token unknown) against each class of caller (anonymous, another organization's member, the owner) and requires the two answers to be identical in all 27, which they are. Nothing in the app calls any share-link function, but all three are reachable over PostgREST by anyone holding the publishable key.
- **`check_org_gates()` credited `auth.uid()` as an authorization check, so a function with no authorization at all scored gated** — a function whose only authorization-shaped line was `DECLARE v_actor UUID := auth.uid();`, a stamp of who asked, passed the check, the database stamped, and another tenant read Acme's parts over HTTP. `auth.uid()`, `current_actor_id()` and `is_org_admin()` say who is calling or what they may do in their own organization; none of them says the caller may act on the organization *named in the argument*, which is the only question this check exists to ask. A gate is now credited only for a call that binds the caller to that organization — `require_org_member`, `is_org_member`, `require_same_org_user`, `require_*_access`. Ten RPCs across `core.sql`, `40-integrations.sql` and `50-extensions.sql` that hand-wrote the membership test out of `auth.uid()` now call those helpers instead; each was correct, and hand-written correctness is what the next edit loses. The probe also stopped being easy to refuse for the wrong reason: it filled text arguments with `'blueplm_gate_probe'`, which no argument validation accepts, so a function could raise before its authorization ever ran and be credited for it. It now reads the accepted values out of the function's own source, so a validation error is no longer a free pass.
- **The anon sweep could not see three shapes, all of which read over HTTP while it reported the schema clean** — a **partitioned table**, because the sweep filtered `relkind = 'r'` and a partitioned parent is `'p'`: its leaves are covered until row-level security is enabled on a leaf, at which point the leaf drops out and the unprotected parent serves every row. A table with **row-level security enabled and a policy `TO anon USING (true)`**, because `relrowsecurity = true` was taken as safety; enabling row-level security and excluding `anon` are two different acts, and the check now reads the policies rather than the flag. And a **view with a column-level grant**, because `has_table_privilege(…, 'SELECT')` is false for one — `GRANT SELECT (part_number)` was invisible, and the check and the remedy both use `has_any_column_privilege` now, so what is reported is what the sweep can clear. None of the three exists in BluePLM today; this is the same argument as adding materialized views last release, so the first one cannot arrive quietly. Each has a negative control that creates it and requires the stamp to be withheld by name.
- **Assessed and deliberately not changed: `anon` holds `SELECT`, `INSERT`, `UPDATE` and `DELETE` on 100 of 101 tables in `public`**, through Supabase's schema default, and every one of those tables rests on row-level security alone. Revoking the grants was proven safe *in the harness* — every attack still refused, every positive control still worked — and is still not being shipped, because the harness does not run the REST API and the REST API's `/health` endpoint reads `organizations` with the anonymous key. Revoking `SELECT` on that one table would turn a healthy deployment into a failing health check on Render and Railway, which is precisely the kind of silent breakage a sweeping grant change causes. The honest answer for now is the check rather than the revoke: `check_anon_reach()` reads the policies of every table and reports one that admits `anon`, which is the property that actually matters, and it is enforced on every table rather than on the list somebody remembered. `harness/sql/anon-table-grants-experiment.sql` is committed so the experiment can be repeated, and the change is a phased one for a release that can also change the API's health check.
- **The previous release moved the "no way out" defect instead of fixing it, and there were two more doors into the same room** — schema 91 corrected the one condition that could never be cleared and left the mechanism that produced it in place. Its anon sweep, `enforce_anon_execute_posture()`, only looked at functions, while the check that grades the result looked at every routine. So a **`PROCEDURE`** in `public` was reported as reachable by `anon` and blocking, the sweep it told you to run reported "0 objects changed", and the stamp was withheld for ever — the same shape as v90, one object kind to the left. The second door needs no migration at all: **any function in `public` owned by `supabase_admin`**, which is exactly what `CREATE EXTENSION` produces there, because Supabase runs privileged extension installs as that role. `postgres` cannot revoke it — Postgres answers `WARNING: no privileges could be revoked` and returns success — and the check graded it blocking. Reproduced both ways in a container with `postgres` genuinely demoted. **Three changes, and the third is the one that matters.** The sweep now covers every kind of routine, procedures and aggregates included, using `REVOKE ... ON ROUTINE`, so what it fixes and what the check measures are the same set. An object that **nobody with your privileges is permitted to revoke** is now reported as advisory rather than blocking, on the same principle that already applied to the default-privilege entry: the test is whether the current role is a member of the role that granted it, so this cannot quietly excuse something you could have fixed, and every such object is still listed by name, in full, every run. And `core.sql` **no longer creates any extension**. Line 28 ran `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` with no `SCHEMA` clause, which on a project where it is not preinstalled lands it in `public` under `supabase_admin` and bricks verification permanently — the crash you would have hit. All 93 columns that defaulted to `uuid_generate_v4()` now use the built-in `gen_random_uuid()`, which has been core Postgres since 13 and needs no extension, and `core.sql` rewrites the defaults on any database that already has the old ones, so the dependency is gone from new and existing projects alike rather than merely being pointed somewhere safer. A verifier that can be made unwinnable is worse than no verifier, because the app reads its answer: the harness now reintroduces both conditions deliberately and requires the stamp to come back after running the remedy the verifier prints, with the procedure still there.
- **A member of one organization could apply another tenant's workflow transition to her own file, and read that tenant's process out of her own history** — `apply_workflow_transition` proved you had access to the *file* and then loaded the transition id you supplied with an existence check and nothing else. Proven over HTTP with a real signed token: an Acme member applied an Umbrella transition to an Acme file, her file's `workflow_state_id` came to point at a state in another tenant, and Umbrella's workflow name, state name and transition name appeared in her `workflow_history`, which she can read. The transition is now resolved through the file's own organization, so a foreign one is "Transition not found" — the same answer as one that does not exist, which is what keeps this from becoming a way to test ids. `execute_workflow_transition` had the same signature shape and was already correct; it was checked by execution rather than by reading, and the same binding was made explicit there so the two cannot drift. **The more important half is why the check written to prevent exactly this did not see it.** v91 added `check_unbound_entity_args()` after `create_file_share_link` was found gating one argument while a second chose the row — and scoped it to functions taking a `p_org_id`, which is the shape of the example rather than the shape of the fault. A function that gates on an *entity* was invisible to it, and that is most of the ones that do real work. The filter is gone: the check now looks at every security-definer function that selects rows by more than one id and requires each of those ids to have an organization check that is not already spoken for by a different one. Seven functions in this release have that shape; six were fine, and this was the seventh.
- **`require_auth` on a share link meant "has a Supabase account", which since signing up is free restricted nobody** — v91's entry says the flag is now honoured, and it is, but honoured as a test that `auth.uid()` is not null. Executed against a link minted with `require_auth = true`: anon was correctly refused, a member of **another tenant** got `is_valid: true` with the file id and the owning organization's id, and so did an account belonging to **no organization at all**. It now means a member of the organization that owns the file, which is the only reading under which the flag is a control rather than a formality, and the organization is resolved from the file before the flag is tested so the two cannot disagree. `consume_share_link` was changed in the same pass and for the same reason: it enforced `max_downloads` by reading a count it never compared, so the limit was decoration. Both functions stay reachable before login, because that is what a share link is for. **Note that a link's usefulness does not depend on either of them** — the download is a Supabase Storage signed URL held by the recipient, as the entry on removing the revoke and download-limit controls explains — so this closes an information disclosure through an RPC that anyone may call, not a hole in file access. The reason it shipped uncaught is worth recording: the harness scored the two attacks covering it as refusals because the setup step they hung off had itself been fixed and minted no token, so the headline fix went out with zero executed coverage in its own suite. Those attacks now mint their own links legitimately and try them from each class of caller, which works in every state of the code.
- **Three checks certified more than they verified, so the next fault of each shape would have passed** — none of these is an open door today; all three are the mechanism by which one would be reintroduced without anybody noticing. **`check_org_gates()` scored completely ungated functions as gated.** It called each function with `NULL` in every argument but the organization id and accepted any raised exception, or any returned `"success": false`, as evidence of a refusal — so a function that validates a different argument first was certified without its organization gate ever being reached, and a function with no authorization of any kind at all was certified too. Two such functions were built to confirm it: both scored `gated`, the database stamped, and an account with no organization then read another tenant's data through them. The probe now fills arguments with values shaped to get *past* that first validation, and it credits a refusal only when it can attribute it to an authorization check the function actually contains. **Materialized views were invisible**: the `security_invoker` sweep filtered on `relkind = 'v'`, and a matview is `'m'`. A matview cannot be `security_invoker` and carries no row-level security, which makes it strictly worse than the plain view that leaked every organization's parts and prices in the entry above, and it produced no row at all — not a warning, nothing. There are none today. **And the NULL-unsafe membership test was matched in one spelling.** All nine sites are genuinely gone, but the check was a literal search for `not in (select org_id from users`, which an alias, a schema-qualified `public.users`, the `<> ALL` form, or writing the function in `LANGUAGE sql` would each have walked straight past. The commit said the shape was banned outright; one spelling of it was. Every form is caught now, in SQL functions and procedures as well as PL/pgSQL. Each of these has a negative control that puts the fault back and requires verification to withhold the stamp and name it, then repairs the *function* rather than dropping it, so a check that reacts to an object's existence instead of to its gate fails the repair.
- **A function created after the sweep is now born unreachable by `anon`, which the previous release had concluded was impossible** — v90 withdrew the default privilege `IN SCHEMA public` and recorded that this cannot work, because Postgres has a hard-wired grant of `EXECUTE` on new functions to `PUBLIC` that lives at the global level and a schema-scoped entry merges with it rather than replacing it. The conclusion was right about the schema-scoped form and wrong about the general case: `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON ROUTINES FROM PUBLIC, anon` **without** `IN SCHEMA` replaces the built-in default, and the next routine created comes out unreachable by `anon` while `authenticated` keeps it. That is now applied, and it is a better answer than sweeping afterwards for the same reason a constructor is better than a cleanup pass: it removes the interval in which the object is open. The sweep stays, because it is what fixes objects created by a role or a tool this entry does not control, and because a posture assertion that nothing enforces is how the last two releases got their claims wrong. `rename_folder_files` also escapes LIKE metacharacters now — a folder called `100%` used to rename every file in the vault whose path started with `100`, confined to the caller's own organization and vault, and pre-existing rather than introduced by any of this.

- **The published API returned its own stack traces to anyone who asked, because "nobody set a variable" meant "this is a developer's laptop"** — a `500` came back as `{"error":"INTERNAL_ERROR","message":"Cannot read properties of undefined (reading 'length')","stack":"TypeError: …\n    at truncateId (/middleware/auth.ts:20:13)\n    at Object.authenticate (/middleware/auth.ts:75:78)\n    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)"}` to an unauthenticated caller holding nothing but a made-up bearer token. That is the file layout inside the container, the internal call structure, and the Node build it is running on, handed over on request. The switch was `process.env.NODE_ENV !== 'production'`, and `api/Dockerfile` deliberately sets no `NODE_ENV` while neither Railway nor Render sets one for a prebuilt image — so the deployment path the documentation actually recommends produced a server that considered itself a development machine. **A 5xx no longer carries the server's message or stack in any configuration, and there is no setting that turns it back on**, because a switch is what leaked it: the response is now `{"error":"INTERNAL_ERROR","message":"Internal server error","requestId":"…"}` and the full error, with its stack, goes to the log under that same id. Nothing is lost, it is only addressed to the right party — quote the id and an operator finds the exact line. Supply your own `X-Request-Id` and it is used verbatim, so a caller can match a failure to a trace it already has. Client errors are untouched: a 4xx still explains itself, in every mode, because its message is the only way a caller learns what to correct.

  **The deeper defect was that one variable decided three unrelated things**, so there was no way to fix one without moving the other two, and the safest setting for one was the wrong setting for another. They are now three decisions. *Error detail* is not configurable at all, as above. *The documentation* has `ENABLE_DOCS`, defaulting to on — hiding the Swagger UI is a documentation choice and not a security control, the whole endpoint surface is already published in `api/README.md`, and three separate documents send integrators to `/docs` to read it; an operator who wants a smaller public surface sets `ENABLE_DOCS=false` and nothing else changes. *CORS* denies by default with a permanent exception for the desktop app, and `CORS_ORIGINS` **adds** to that allowlist rather than replacing it, so an operator following the old advice to "set `CORS_ORIGINS` to your ERP domains" can no longer lock the product out of its own API. `CORS_ORIGINS=*` — which this repository shipped in `render.yaml`, and which really did let any website read the API's responses — is ignored with a warning naming it, rather than refused outright, so a deployment picking up a new image keeps running instead of crash-looping on a value we put there ourselves. The effective allowlist is logged at boot either way, because a CORS refusal looks like a network error in the browser and leaves nothing on the server to find.

  **`NODE_ENV` itself now defaults to `production`.** In a file where every secret is required and fails closed, a value whose default was the least safe option was the odd one out. It decides only developer conveniences now — log format and level, the request-debug hook, and whether the Vite dev server is an allowed origin — and development is opted into explicitly by `npm run api`, which is a small script rather than an inline `NODE_ENV=development …` because that spelling is POSIX shell syntax and npm runs scripts through cmd.exe on Windows. In the same pass, the two remaining raw reads of `process.env.NODE_ENV` are gone. Fastify's request logger read the validated `env.NODE_ENV` and the standalone logger read the raw one, and with the variable unset they disagreed: one emitted pretty-printed debug lines and the other JSON at info, interleaved on the same stream, so neither format could be parsed. Both are now built by the same function from the same input.

  **The premise that made this urgent turns out to be false, and it is worth writing down.** The reason a naive `NODE_ENV=production` was considered too dangerous to just set is that the packaged app loads its renderer with `loadFile`, making it a `file://` page, and a `file://` page was expected to send `Origin: null` and be subject to CORS — so deny-by-default would have taken Integrations, Customer Sync, Webhooks, the Suppliers view and the version check offline for every user. Measured rather than assumed, against Electron 39.2.7 — the version the release build embeds — that is not what happens: a `file://` page's `fetch()` sends **no `Origin` header at all**, the response arrives as `type: "basic"` rather than `"cors"`, and a server returning no CORS headers whatsoever is read successfully. The packaged app is not a CORS client of this API. A `npm run dev` renderer is, and was observed being refused by a production-mode server and served by a development-mode one, which is why the Vite origin is allowed in development. `null` stays in the allowlist regardless, as insurance rather than a live dependency: it costs nothing against an API that authenticates with a bearer token and reads no cookie, and it means "the desktop app works" does not rest on an undocumented Chromium behaviour continuing to hold.

  Verified by building both images and asking them, not by reading the source. The same request that returned the trace above returns `{"error":"INTERNAL_ERROR","message":"Internal server error","requestId":"…"}` from the new image with nothing configured **and** with `NODE_ENV=development`, while the log line under that id still carries the whole stack. Across five configurations of the new image — nothing set, `NODE_ENV=development`, `ENABLE_DOCS=false`, `CORS_ORIGINS=*`, and `CORS_ORIGINS=https://odoo.example.com` — `Origin: null` is allowed in all five, `https://evil.example` is refused in all five (the preflight returns 204 with no `access-control-allow-origin`, which is the refusal), the ERP origin is allowed only where it is configured, and `/docs` answers 200 or 404 strictly according to `ENABLE_DOCS` and nothing else, including under `NODE_ENV=development`, which is the whole point of separating them. `ENABLE_DOCS=flase` refuses to start and says which values are accepted, rather than reading as "on". Nothing else moved: the OpenAPI documents from the old and new images are byte-identical once the version number is normalised — all 73 routes across twelve route modules and thirteen tags, and all eleven `@fastify/helmet` headers. **The API version goes to 2.6.0** rather than staying put: unlike the build change that preceded it, this one is observable on the wire — a 500 body loses two fields and gains one, and CORS headers change — so the number that means "the contract moved" should move, and every deployment ought to be told to pick this up. It is a minor bump because no status code, endpoint or success payload changed, and nothing has ever read the `stack` field.

- **A request to an extension endpoint was refused with 401 and then carried out anyway** — the catch-all serving `/extensions/{id}/{path}` authenticated callers itself, inside a `try`/`catch`, instead of through the guard every other protected route uses. That guard sends the 401 *and* throws, and the throw is what stops the request; the `catch` was empty and swallowed it. Because the reply had already gone out, nothing further reached the caller and the only trace was a single `Promise errored, but reply.sent = true was set` line in the server log. Everything after the `catch` then ran on a request that had just been refused: the organization was read from an `X-Org-Id` header the caller had written, and with no authenticated user there was no user-scoped database client, so it built one from the publishable key. This was reproduced against the running image with the database pointed at a recorder rather than deduced from the source, because from outside there is nothing to see. One anonymous `GET /extensions/foo/bar` carrying `X-Org-Id: victim-org-…` returned 401 to the client and sent `GET /rest/v1/org_installed_extensions?select=*&org_id=eq.victim-org-…&enabled=eq.true` to the database, with the publishable key as both `apikey` and bearer; a control `GET /vaults` in the same run made no database call at all, and took 1 ms against the extension route's 21 ms. On a deployment where that row comes back it carries the extension's manifest, its handler source and its allowed domains, and a handler marked `public` would have been executed in the sandbox on the strength of it — the response thrown away, the side effects kept, which is a write primitive that returns nothing and so shows up nowhere. **The route now sits behind the same `preHandler` guard as every other protected endpoint**, which is the actual repair: Fastify does not reach a handler once a `preHandler` has refused the request, so "refused" and "did not run" are one event rather than two that have to agree, and no `catch` can put them back out of step. The organization comes from the authenticated user, and `X-Org-Id` is no longer read anywhere. The loader cache, which was keyed on that header and never evicted or bounded, is now keyed on an authenticated organization and holds at most 100. The rest of the API was checked for the same shape — a guard invoked by hand inside a handler rather than as a hook — and there is none; every other route registers it as a `preHandler`. Verified against a rebuilt image: the same request returns the same 401, and the recorder sees nothing at all.
- **Schema 90 could never be recorded on a real Supabase project, so the app would have said "database out of date" for ever** — everything installed, all 35 objects the manifest asks for reported present, every organization gate passed, and then the stamp was withheld and the script told you to run a function that had just failed to do anything. The cause: Supabase's bootstrap creates a default-privilege entry owned by `supabase_admin` that grants `EXECUTE` on new functions to `anon`, the `postgres` role your SQL editor runs as is not a member of `supabase_admin` and cannot alter it, and the check treated that as fatal. The release contradicted itself about the same condition — the lockdown script hit it, printed `COULD NOT CHANGE`, and still said `PASS`. It is now advisory in both places, with the same wording. It has no effect on anything that exists, because everything shipped is revoked from `anon` by name; its only real consequence is that a function created by some *later* migration is born reachable, and that is still caught by name and still blocks the stamp. This was not visible in the previous release's own testing because the container it was verified in ran `postgres` as a superuser — Postgres 16 and later silently refuse `ALTER ROLE postgres NOSUPERUSER`, so the demotion Supabase performs never happened and every privilege check answered yes for the wrong reason.
- **`parts_with_pricing` returned every organization's parts and prices to anyone with the publishable key and no login** — file ids, part numbers, descriptions, paths, revisions, states, preferred supplier, supplier code and unit price, over a plain `GET /rest/v1/parts_with_pricing`. Two things had to be true at once and both were. A view has no row-level security of its own, and this one was not `security_invoker`, so it read its underlying tables as its owner and their policies did not apply either. And nothing in the release could see it: the anon check filtered on ordinary tables and skipped views entirely. The view is now `security_invoker` and granted only to signed-in roles, so a member of one organization sees their own parts through it and nothing else; every view and materialized view in `public` is now swept by the schema, by the lockdown script and by verification. Reproduced before and after against a container built from Supabase's own bootstrap with `postgres` genuinely demoted: before, an anonymous `GET` returned another tenant's ITAR-marked part with its unit price; after, `permission denied for view parts_with_pricing`, while a signed-in member of that organization still reads their own rows.
- **Anyone with an account could create a working share link for any other organization's file** — `create_file_share_link` took an organization id and a file id, checked that you belonged to the organization, and then inserted the file id without ever asking whose file it was. Passing your own organization id with a foreign file id minted a real token; redeeming it anonymously returned `is_valid = true` and the file, and it did so even with `require_auth = true`, which the validation function ignored completely. The organization id it handed back was the link's rather than the file's, so anything downstream looked in the wrong tenant. It now derives the organization from the file and ignores the argument, `require_auth` is honoured, and the same review found the same shape — a check on one argument while a second argument chooses the row — in `set_item_designation_assignment`, which is fixed too. Verification gained a check for that shape specifically, because neither existing check could see it: calling the function with nulls produced a refusal, and the roles allowed to execute it were correct.
- **A newly signed-up account with no organization could read and change other organizations' data** — nine membership tests were written as `p_org_id NOT IN (SELECT org_id FROM users WHERE id = auth.uid())`. For an account whose `users.org_id` is still `NULL` — which is every account between signing up and joining — the subquery returns one `NULL` row, `NOT IN` evaluates to `NULL` rather than true, the `IF` is not taken and the function runs against whatever organization was named. From such an account it was possible to read another organization's Odoo configuration including its instance URL and database name, read its integration status, read its item designations and their assignments, and overwrite and then delete rows in its `item_images`. The API was never the way in — it refuses users with no organization — but PostgREST is reachable directly with the publishable key. All nine are gone, including the four that happened to be covered by an adjacent admin check, because a gate whose correctness depends on a neighbouring condition is not a gate. Verification now scans for the shape and refuses to certify a database containing it anywhere.
- **A share link could be spent without anything being downloaded** — asking whether a link was still valid counted as a download, so a ten-download link was dead after twelve calls from anyone holding the token, and its owner had no way to tell what had happened. Validating and downloading are now separate, and only the download counts. In the same pass, share tokens are 128 bits from the database's cryptographic random source rather than twelve characters from `random()`, which is a pseudorandom sequence and not a secret; and `get_org_auth_providers` now renders an organization that exists and one that does not through the same code path, because they previously differed in key order and in the spaces around the colons — enough to enumerate which organization slugs are real, and then to read which single sign-on providers each of them uses, without an account.
- **Anyone who knew your project's address could lock, rename and read your files without an account, and the fix in the entry below did not work** — that entry describes withdrawing `EXECUTE` from `PUBLIC` on the functions it had gated. On Supabase that removes nothing. Supabase's own bootstrap runs `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role`, so every function is created carrying an **explicit** grant to `anon` — the role a caller gets when they present the publishable key and no login — and revoking from `PUBLIC` strips the separate world grant while leaving the `anon` one untouched. All 159 functions stayed callable by anyone. The check written to confirm otherwise asked `has_function_privilege('public', ...)`, which is a question about the world grant rather than about `anon`, so it answered "nothing to do" and the verification script printed an all-clear over a completely open database. Both were verified by execution against a container carrying Supabase's real bootstrap; the absence of that bootstrap from the earlier test is what hid all of this. **The roles are now named.** `EXECUTE` is withdrawn from `anon` by name, from every function in `public` except two that genuinely run before you log in — `get_org_auth_providers`, which the sign-in screen asks which methods your organization allows, and `validate_share_link`, which is how a share link works for someone who has no account. Those two are declared in one list in `core.sql` that the verifier reads, so the exception is stated in one place rather than implied by an absence. The default privilege that recreates the grant is withdrawn too, so a function added next month is not born open. Signing in, accepting an invitation, joining by organization code and resetting a password are unaffected: the desktop app and the renderer authenticate with the publishable key but carry your user token, which makes them `authenticated` and not `anon`, and the API reserves its service-role client for invitations, the credential store and customer sync. `supabase/tools/emergency-lockdown.sql` applies exactly this closure to a running database on its own, without any of the rest of this release, for the interval between reading this and finding time to upgrade.
- **Thirteen more functions took an organization's file or ECO and asked nobody's permission** — the entry below gated the functions that take an organization id as an argument. It did not gate the ones that take a *file* id, or a vault id, or an ECO id, and then reach the organization through it, which is most of the ones that do real work: checking a file out and in, moving and renaming it, running it through a workflow, reading someone's permissions and vault access, instantiating a change-control process. Proven end to end as an unauthenticated caller: `checkout_file` on another organization's file returned `{"success": true}` with the whole row — part number, description, storage path — and then `move_file` renamed it. Each of these now resolves the organization from the entity it was handed and checks membership against that, and a file that belongs to someone else is refused with the same "File not found" as a file that does not exist, so this is not a way to discover which ids are real. **They also stopped believing the caller about who they are.** The acting user was an argument, `p_user_id`, which meant the audit trail, the checked-out-by marker and the version history recorded whatever the caller typed there — someone else's name, on an action they did not take. It now comes from the signed token. The argument remains in every signature so that nothing calling these needs to change, and is ignored. Three functions that run only from triggers, where there is no caller to identify, were withdrawn from every role instead of being gated. A separate class turned up in the same sweep and is fixed with it: six SOLIDWORKS licence functions asked whether you were an admin without asking *of what*, so an admin of any organization could assign, revoke, activate and deactivate any other organization's licences.
- **The verification script could certify a database that was 62 tables short, and did** — `verify-schema.sql` is what this release asks you to run at the end of an upgrade, and what records the version the app then trusts. A database with only `core.sql` applied — no files table, no workflows, no inspection, 62 of 76 tables absent — was stamped as fully verified at version 89. Each required module was probed by asking whether one of its own tables existed, and a missing table was read as "this module is not installed, skip it" rather than "this module is missing", which is a distinction the manifest could not express for a module that is not optional. Required modules now have no such escape. Three further defects came out of the same review and are fixed together. The check that a function contains its authorization check read the function's source for the words, so a check inside a comment or inside `IF false THEN` satisfied it, and both were accepted; comments and string literals are now stripped, and — the part that actually settles it — verification now **calls** each org-scoped function with an organization id the caller has nothing to do with and requires it to refuse, inside a transaction that is always rolled back. A dead-branch check that still passes the text test is caught by that. Modules drop their functions by exact signature, so a previous release's copy with a different argument list survived an upgrade and sat beside the current one, reachable over the API by naming its arguments; leftover overloads are now detected by name and reported with the `DROP` that removes them. And the four checks that would have caught any of this were all `RAISE NOTICE`, printed beside a stamp that consulted only the manifest, so the script could tell you the database was wide open and pronounce it verified in the same run — they now withhold the stamp and end the script with an error.
- **Stamping the schema version reported success to callers who had not written anything** — `schema_version` is protected by row-level security and only the service role may update it, so for anyone else the update matched no row and succeeded quietly. Nothing checked how many rows had changed, so the function returned `{"stamped": true}` with the recorded version untouched, and both `anon` and `authenticated` could get that answer. It now fails, saying which role could not write and where to run it from. A comment claiming only the schema owner could reach the function was wrong in both halves and is gone; the function is now withdrawn from `anon` and `authenticated` by name, which is what makes the claim true.
- **A database function that took an organization id would act on any organization you named** — the RPCs that hand out RFQ numbers, hand out serial numbers, read an organization's settings and list a vault's files all run with row-level security switched off, because that is what `SECURITY DEFINER` means, and they took the organization id in their arguments as fact. None of them looked at who was calling. Worse, PostgreSQL grants `EXECUTE` on a new function to everyone, so the `GRANT EXECUTE ... TO authenticated` written beside each one read as a restriction while granting a privilege the world already had — the functions were reachable **without signing in at all**. Verified in a container: an anonymous caller asking `generate_rfq_number` for another organization's id got back `RFQ-2026-0003`, which told them that organization had raised two RFQs this year, created a counter row for it seeded from RFQ rows they could not otherwise read, and burned a number out of its sequence. The same caller got every part number and description in another organization's vault out of `get_vault_files_fast`. Thirteen functions now begin by proving the caller belongs to the organization they named, and the whole class has had `EXECUTE` withdrawn from `PUBLIC` so the grants mean what they say. Three functions that create an organization's default teams, job titles and customer categories keep no membership check, because they run from a trigger at the instant an organization is created and it has no members yet; they were withdrawn from `PUBLIC` instead, which removes them as endpoints entirely. `supabase/tools/verify-schema.sql` now fails if any org-scoped function of this kind stops consulting the caller, so the sweep is a standing rule rather than a one-off. Naming an organization that does not exist, or none at all, now returns a plain authorization or "organization is required" error instead of leaking a raw foreign-key violation.

### Added
- **Vault Audit — find out whether BluePLM and your SOLIDWORKS files still agree, from Settings rather than from a terminal** — the divergence scan shipped in 3.24.0 and could only be started with `npm run scan:divergence`, which put the one person who needs its answer behind a command line. It is now **Settings → Organization → Vault Audit**, visible to admins only. Pick a scope, press Run, and watch a progress bar: a full vault is around eight thousand documents at roughly twenty milliseconds each, so about three minutes, and it can be cancelled after the file in flight. The default scope is the files BluePLM already records per-configuration metadata for, which is where a configuration record can have lost something and is roughly a fifth of the work; whole-vault and single-folder are the other two. The result leads with how many files have any finding at all, then sorts the individual values into four buckets ordered by how little can be done about each: **lost from both sides**, which nothing can bring back; **the two disagree**, where both copies survive and a person has to choose; **the file still has it**, which is real damage with a known-good source; and **not BluePLM's to hold**, which is not damage at all and would be an invention to "fix". Every value drills down to the file, the configuration and both sides' values, with a jump straight to the file in the browser. **Configurations are compared by name and never by count**, which is not a detail: one part in this vault carries twenty-six configuration entries against fifteen real configurations, and by count that record looks eleven entries short when in fact it describes every configuration the file has plus eleven keys for configurations that were since deleted. Those are reported as stale entries — housekeeping — and never added to anything called a loss. **The audit reads and reports; it repairs nothing**, writes nothing to the database and touches no file in the vault. Reads go through a new Document-Manager-only path rather than the ordinary property read, which asks whether SOLIDWORKS has the file open and reads through the live session when it does; documents SOLIDWORKS is currently holding are skipped and reported as unread, so an audit cannot disturb a session in progress. Results are recomputed each time rather than stored, because a saved audit stops being true the moment anyone checks a file in and does so silently; the JSON artifact the scan already writes to the log directory remains the durable copy, and it carries the timestamp that makes its age obvious.
- **The Vault Audit needs SOLIDWORKS service 1.21.0, and on an older one it now says so before it starts rather than failing on the first file** — the audit's Document-Manager-only read is a new service command, `getPropertiesDocumentManager`, which is what lets a vault-wide walk read eight thousand documents without routing a single COM call through the SOLIDWORKS you have open. It shipped without a version, and that is the whole of this entry: the service on your computer was built before the command existed, the app's version check compared two numbers that were still equal and reported "Service is up to date", and the audit would have walked for three minutes and then failed on every file with an error that read like a vault full of unreadable documents. **The service is 1.21.0 and the app expects 1.21.0**, so a machine that has not rebuilt is now told it has not rebuilt. Rebuild with `npm run build-sw-service` and restart the service. Until you do, the Vault Audit page shows the same "Service rebuild required" notice the Service tab has always shown — the same words, from the same check, because a second wording invented at the point of failure is how "up to date" and "this cannot run" end up on screen together — and the Run button is inactive rather than starting something that cannot finish. Nothing else in the release needs the new service; this is additive, so the minimum compatible version is unchanged and every other feature keeps working on the service you have. **The version check is now the second line of defence rather than the only one.** A version gate is a claim about the service made somewhere other than the service, and it can drift again exactly as it just did, so the service itself now answers an action it does not implement with `errorCode: "UNKNOWN_ACTION"` and the name of the action, instead of prose that any failed read could also have produced. The audit recognises that answer, stops on the first file, and reports that the service is missing a command — rather than recording eight thousand files as unreadable, which is the report that would have sent someone looking at their vault.
- **A repair for the configuration entries the old check-in erased — as SQL you read before you run it, not a button** — `jsonb ||` is a top-level merge, so the pre-fix `checkin_file` patching `custom_properties._config_tabs` with only the configurations you had edited replaced the whole map with those few, and an empty-but-present pending map replaced it with nothing at all. Both were fixed in schema 87, but nothing rewrites the rows that were already truncated and nothing else in the codebase writes these maps, so there is no self-healing: those rows stay short until something puts the entries back. The values themselves were never lost — the wipe destroyed the database's copy and not the file's, and the SOLIDWORKS documents still hold them. `npm run repair:config-maps` reads two files you produce yourself, a shape export from the SQL editor and the Document Manager census, and prints what it would fill. With `--emit-sql` it writes a `.sql` file for whoever owns the database to read and run; **there is no database client anywhere in its import graph, so the tool cannot apply anything even if you ask it to**, and it does not open the vault either. **Losing data is not something this can express**, which is a stronger claim than it being careful: every proposal is an entry for a configuration key that is *absent* from the row, filtered on key presence before any value is looked at, and every generated statement writes `computed || existing` with the live row on the right — so an entry the row already holds wins on every shared key, the key set only ever grows, and the right-hand side is read when you run it rather than when the plan was made, which means a stale plan degrades to a smaller repair and never to an overwrite. There is no `DELETE` and no way to remove a key. Keys naming configurations that no longer exist are reported so you can see them and left exactly where they are. A row whose map is absent entirely is skipped rather than created: the database never described that file's configurations, so the document's values were never BluePLM's to lose, and adopting them would invent database state rather than restore it — the same judgement the Vault Audit calls "not BluePLM's to hold". Values are read only from the keys BluePLM's own writers produce, taken from the divergence module's field specs rather than restated, so the tool tracks that list instead of becoming a sixth copy of it. Deriving a configuration's tab by splitting its `Number` is possible, off by default and always labelled as derived, because that produces a value the database never distinctly held.
- **Every pull request and every push to `main` now has to pass the typecheck and the tests before anyone looks at it** — this repository had three GitHub Actions workflows and none of them ran a check. They build installers on a tag, publish the API image, deploy the docs; nothing verified a change before it landed. The `catch` block above that reported `extensionId is not defined` on every failed extension install is exactly what that costs: a one-line compiler error, in a file the authoritative gate did not cover, that reached users because the gate was something a person had to remember to run. A new `CI` workflow runs `npm ci`, `npm run typecheck` and `npm test` on both triggers — a fresh install from the lockfile, so a dependency that is only present because it is already on someone's disk fails here rather than in a release. A full run takes about a minute of compute. Linting runs beside it and is deliberately **not** blocking: `npm run lint` currently reports 136 errors and 539 warnings across 172 files, all of them pre-existing, and a gate that is red the day it is installed gets switched off before anybody fixes anything. It reports the count so it can be driven down, and it can be made blocking once it reaches zero. The workflow runs on Node 22 rather than the Node 20 the release build uses, because on Node 20 the test run is not merely slower or noisier but wrong: `src/lib/network.ts` reads `navigator.onLine` when it is imported, `navigator` is a global that arrived in Node 21, and on 20 two suites fail to import and 25 tests silently do not run. Node 22 is also what Electron 39 embeds, so it is the closer match to what this code runs on in the first place. The C# tests under `solidworks-service/` are not wired in: they target .NET Framework 4.8 and the Document Manager tests need a licensed SOLIDWORKS installation, neither of which a hosted runner has.

- **The REST API is now typechecked by that same gate, and the reason it was not is worth writing down** — the gate covered the desktop app and the Electron main process but skipped `api/`, because `npm run typecheck:api` failed and a gate that is red on the day it is installed gets switched off. It failed on two errors that both read as something serious: `@fastify/helmet` could not be found, and `FastifyReply` was an unknown name. Neither meant what it looked like, and **no deployed API was ever affected by either** — `@fastify/helmet` has been listed in `api/package.json` and pinned in `api/package-lock.json` since v3.18.0, added in the very same commit as the import that uses it, and the published image is built by installing from exactly those two files. What was missing was an install, not a dependency: `api/` is a separate deployable with its own manifest and lockfile, the root `npm ci` does not touch either of them, and so a typecheck run from the repository root resolved the API against whatever the desktop app happened to have hoisted into the shared `node_modules` — a different set of packages, at potentially different versions, from the ones that actually ship. The gate now installs `api/`'s own lockfile before typechecking it, so the API is checked against the versions its image is genuinely built from rather than against the desktop app's coincidental neighbours. The second error had the same root and a more instructive shape: `api/types.ts` names `FastifyReply` inside a `declare module 'fastify'` block without importing it, and names in such a block resolve against the ambient type graph rather than the file's own imports — so it compiled only as a side effect of `@fastify/helmet` being installed and pulling Fastify's types into scope. Deleting nothing but helmet reproduced both errors together. The type is now imported explicitly and the hook it describes given a name of its own, so a file that defines the API's own types no longer needs an unrelated security package present in order to mean anything.

### Changed
- **Three share-link controls that had no effect are gone: revoke, the download limit, and "require sign-in"** — a share link is a Supabase Storage signed URL handed straight to the recipient, so the download never reaches BluePLM and nothing BluePLM records about the link can influence it. Expiry works, because Storage is what enforces it. Nothing else did. `revokeShareLink()` set `is_active = false` on a row that gates no access, so the signed URL kept working exactly as before until it expired — the most dangerous of the three, because sooner or later someone clicks it on a leaked link and believes the file has been secured. It had never been wired to a button, which is the only reason nobody has been misled yet; it is removed rather than left as a working function one commit away from a "Revoke" menu item. The `share --max-downloads=N` terminal flag was genuinely reachable and printed `Max downloads: 3` back at you, having stored a number no download path ever read. `require_auth` was stored and consulted by nobody. Counting downloads and recalling issued links are now stated non-goals rather than unfinished work, and the reason is written beside the code that mints the URL so that the next person does not rebuild the same promise. **No link already in circulation is affected** — those are signed URLs, they will keep working until their own expiry, and nothing about this release is retroactive. What remains is the feature as it honestly is: a link anyone holding it can download from, until it expires.

  Removed alongside the controls: `getFileShareLinks()`, which listed a file's "active" links for a management view that was never built and would have implied the same control in another shape; `validateShareLink()`, a client-side re-check of expiry and the download limit that gated nothing and read two fields the app no longer writes; and the dead download-limit and sign-in state on the share modal. The `file_share_links` row is kept, because who shared what and when is worth recording, and the best-effort `try`/`catch` around its insert is now correct rather than a defect — a row that fails to land costs an audit entry and no longer costs enforcement. Three database functions, `create_file_share_link`, `validate_share_link` and `consume_share_link`, have no caller anywhere in the application; they are left alone here and noted for a later schema pass.

- **An extension's `public` endpoints are documented as needing no login, and none of them has ever worked** — the manifest accepts `"public": true`, the documentation offers it for webhook receivers and OAuth callbacks, and the loader has always recorded it. It has never been reachable. Authentication ran before the handler and answered 401, so an anonymous caller could not receive a public handler's response even while, as the entry above describes, the handler's side effects were being carried out for them. Fixing the hole settles the second half too: every extension endpoint now requires a token, and `public` is not honoured. This is left as a stated gap rather than quietly implemented, because serving an anonymous caller means deciding which organization the request belongs to without a credential, and the header that used to answer that question is exactly what let any caller name any organization. A safe version needs an unguessable per-installation URL, which is a schema change and a design decision rather than a bug fix. Until then the server logs a warning naming every route declared `public` when it loads, so an extension author finds out at install time rather than from a webhook that silently never fires, and both `docs/extensions/contributions.md` and `docs/extensions/manifest.md` now say so where they used to promise otherwise.
- **The build that ships to users and the gate that vets it now run the same version of Node** — the new CI workflow pinned Node 22 because the tests genuinely cannot pass on 20. `release.yml`, which builds the installers people actually download, still pinned 20, and so did `deploy-docs.yml`. A gate is only worth what it has in common with the thing it is guarding, and vetting a change on one runtime while building the release on another leaves exactly the gap the `navigator` bug below lived in. Both are now on 22, which is what Electron 39 embeds and what `@electron/rebuild` declares in its own `engines` field. This was verified before it was changed rather than after: the full release build was run end to end on Node 22.23.2 — install, typecheck, Vite build, `@electron/rebuild` against Electron 39.2.7, and electron-builder through to a packaged application — and the app was also built and started from a container on 22. `publish-api.yml` pins no Node at all; the API's version lives in `api/Dockerfile`, which moves from `node:20-alpine` to `node:22-alpine`, and that image was built, started and probed on 22 before the change was kept. `package.json` now carries an `engines` field of `>=22.12.0` — the version `@electron/rebuild` asks for, rather than a number picked for looking tidy — so installing on Node 20 now prints an explicit `EBADENGINE` warning naming the requirement instead of quietly producing a test run that is 25 tests short. Note that npm treats this as a warning rather than an error unless `engine-strict` is set, so it informs rather than blocks.
- **A brand-new database is no longer told it is too old** — a fresh install records version 0, meaning "verification has never run against this", and the app compared that against the minimum version it supports, concluded the database predated everything it knew about, and raised a permanent error toast saying the database was too old and quoting a minimum it had already met. That is the state of every database in the minutes between installing it and running `verify-schema.sql`, so the first thing a new installation did was accuse itself. Version 0 now reads as a database that has not been verified yet, with a dismissable notice saying which file to run.
- **Applying a module to an older `core.sql` now stops at the first line instead of the last** — every module ends by calling two functions that `core.sql` defines, and its gated functions call a third. Against an older core, a module applied in full, created everything it creates, and then failed on its closing line — leaving, in the case of `30-supply-chain.sql`, RFQ numbering installed but non-functional and an error message pointing at line 944 of a file whose real problem was that it was run in the wrong order. Each module now checks for what it needs from `core.sql` before it creates anything, and says which file to run first.
- **A half-applied schema can no longer report itself as complete** — the app decides whether to warn you that your database is out of date by comparing one number in the database against one number in the app. That number used to be written as a side effect of running a file: `core.sql` stamped it, and so did each module, on the reasoning that re-running one module to pick up a single fix should move the version along. It cannot, and the consequences were all reproducible. Applying only `30-supply-chain.sql` to a version-86 database recorded 88 — while the version-87 fix in `10-source-files.sql` was absent, and the app, seeing 88 against its own 88, said the database was up to date and let a known configuration-wiping bug keep running with nothing on screen to suggest anything was wrong. Re-running `core.sql` by itself did the same thing with neither fix present. And under the command-line install path documented for the modules, a file that errored partway through still reached its stamp at the end. The cause is structural: the version is one global number, the files are per-module, and no single number can express "30 applied, 10 not", so any file that writes it is guessing about the others. Nothing writes it as a side effect any more. `supabase/tools/verify-schema.sql` writes it, and only after checking a manifest of the objects this release requires — including whether the functions above actually contain their new authorization check, so an old copy of a module is caught and not just a missing one. Run a subset of the files and the old number stays put, which shows up as "database out of date": a warning you can act on rather than a green light over a database nobody has confirmed. The price is one more file to paste at the end of an upgrade, and the loss of the ability to advance the version by re-running a single module — which is precisely the ability that caused this.

- **An edit you have not checked in no longer pretends the server already has it** — editing an item number, description or revision wrote the new value into two places: the list of changes waiting to be checked in, and the app's in-memory copy of the server's row. The second copy is what the previous release described as being removed later; this is that removal. It existed to make an edit appear instantly, which it did, but it also erased the difference between a value the server holds and a value you have merely typed — so nothing in the app could tell you which was which, and nothing could put the row back if the write that followed did not land. Everything that shows you one of those fields now lays your edit over the server's value as it draws, which is what the previous release's overlay work was for, so the immediacy is unchanged. What changes is that the server's row now says what the server actually said, which is what the drift scan, the realtime updates and the check-in comparison all needed it to say. One surface deliberately keeps reading the server's value on its own: the SOLIDWORKS panel's "Sync from File", which asks whether the file disagrees with the database — overlaying your unsaved edit there would answer a different question and report "already up to date" for a file still holding the old value.

- **"Sync Metadata" on a part with many configurations is quick again, and still checks its work** — the previous release made every metadata write prove it landed by reading the file back afterwards, which is worth having and is not what cost the time. What cost the time was that the verified path wrote one configuration per call, so a part with 68 of them was opened and saved 68 times where the old unverified path had opened it once. Configurations now go to SOLIDWORKS in a single batched write, and the read-back that confirms them was already a single call, so the whole operation is two calls whatever the configuration count. Measured on the 68-configuration o-ring used for regression testing, writing 275 properties: eleven and a half seconds of writing before, under one second after, and the complete write-and-confirm cycle down from 11.8 seconds to 1.4. The confirmation is unchanged in what it can tell you — it names each configuration that did and did not take the change, so a part where two of 68 fail still reports those two by name rather than a single "partly failed". That mattered enough to check rather than assume: the batch call reports which configurations it refused, and where it reports a configuration only in passing rather than naming it, the read-back is what decides, exactly as before.

- **Work you did not ask for can no longer open a SOLIDWORKS window** — every request BluePLM makes of SOLIDWORKS now says who asked for it. A request you triggered — expanding a drawing, running a command — is allowed to jump the queue and, if nothing else can answer it, to open the document. A request the file watcher triggered is not: it is answered without SOLIDWORKS or it is not answered, and it waits behind anything on screen. The saves that caused this were ordinary — 88 drawings changed in one folder, each read as its own job at the same priority as the click you had just made — and the result was three minutes of drawings flashing open and closed in front of someone who had asked for none of it. A watcher batch is now a single job that reads one drawing at a time, and a newer batch replaces the running one and discards the reads it had queued rather than draining answers that describe a state of the disk that has already changed. The log line that announces a batch now names a few of the changed paths and the folder they share, so an unexplained one is diagnosable after the fact instead of being a bare count. **The rule above is now structural rather than a matter of timing.** As first written it was a check placed in front of the one step that opens a document, and one step earlier — the cheap read of a document SOLIDWORKS already has open, which every request including a watcher's is allowed to make — called the same routine the gated step did. That routine opens the file when the handle is not there, and starts SOLIDWORKS to open it, so the only thing keeping a watcher away from a window was an "is it open?" answer taken microseconds earlier, and a document closed in that gap would have been reopened by BluePLM. The cheap read now goes through code that has no route to opening anything: it asks the running SOLIDWORKS for the document, and if there is no running SOLIDWORKS or it is not holding the file, it says so and the watcher's request ends there. This is asserted by walking the compiled call graph of that routine and everything it reaches, so a future edit that reintroduces the reachability fails the build rather than waiting for another incident.

- **The guard that stops a metadata field being read behind the overlay now asks the type checker, because a name is not what the bug has in common** — an item number, description or revision has two sides: what the server holds and what you have typed and not checked in. Reading either one directly is how a renumber came to be ignored by a PDF filename and a title block, and one shared overlay is what decides between them. The guard against a new direct read has been three things. It began as two regexes looking for the reversed pair, which caught one of the ten ways there are to write it. It became a scan of the syntax tree, which caught all ten and was then shown nine more that got past it — a parameter destructured under another name, array destructuring, the row carried on an object property, the row returned from a helper, `file['pdmData']`, a computed field name, a reassignment rather than a declaration, and a row that never passes through a name like `pdmData` at all, which is what a query result is. Every rule it had was rooted at a name, and there is always another spelling. What all nineteen have in common is a type, so the scan now builds a real program from the project's own `tsconfig.json` and asks the compiler which interface each property it reads was declared on. All twenty-one shapes are compiled and run against it in the test, along with three that must come back clean, and each records whether the previous scan caught it, so the widening is measured rather than claimed. **The anti-vacuity test was hollow and is not any more**: the three tests asserting that no call site decides for itself all passed with the scan's two main rules deleted, because the test file was inside its own scan and matched itself four times on an unrelated rule while the one test meant to prove otherwise asserted only that *something* had been found. Test files are no longer scanned, and the guard is now that every written-down exemption must still name a real read — delete a rule and the exemptions go stale in a heap. Verified by doing it: removing the property rule fails 19 tests including all three, and removing the reserved-key rule fails 3. **Exemptions are scoped to a function rather than a file.** A whole-file allowance covered `useConfigHandlers.ts` at 978 lines, so a new direct read anywhere inside it was invisible; three entries had gone stale and were exempting nothing at all. The reasons the previous work recorded are kept, because they are worth more than the list — the SOLIDWORKS panel asks whether the file disagrees with the database, a deviation records a checked-in state, the `metadata` command prints both sides on purpose. The honest count, derived rather than inherited and true as of this commit: **162 direct reads in 21 files out of 955 scanned**, exempted by 33 named functions plus the overlay module itself. Eight of those 21 files were invisible to the previous scan entirely, among them the whole write-planning layer. Its limits are written down beside it: a value typed `any` or `unknown` carries no symbol, which is why the two reserved configuration-map keys inside the untyped `custom_properties` column are still matched by name; and a row whose columns land in an anonymous type rather than in `PDMFile` — an RFQ line, a review row — is deliberately out of scope, because no local file stands beside it and there is no pending edit to overlay. The structural fix that would retire this scan is a `PDMFile` whose three governed fields only `overlay.ts` can unwrap, which would make a direct read fail to compile; it is a change to the row type, the overlay, the Supabase mappers and all 21 files at once, so it is not a rider on a test.

- **A persisted map keyed by file path can no longer be added without the rename knowing about it, whatever it is called** — these maps hang off a file's absolute path rather than off the file, so renaming a file is a data migration and every one of them has to move. The registry that lists them is checked against the state in both directions; the direction that mattered was checked by a regular expression over one file, which required exactly two spaces of indentation, a name of letters only, a literal colon and the literal word `Record`. It was tested by adding an unregistered map, and it failed correctly. Then four more spellings of the same map passed it: an optional `?` before the colon, an inline `{ [path: string]: string }` instead of `Record`, a type alias, and a digit in the name. A map declared in a different slice file was invisible to it entirely. It is now a type — the `persisted*` keys of the store state whose values are keyed by string, minus the ones the registry names, which must be empty — so an unregistered map stops the build with the compiler naming the key, and it does so wherever the map is declared and however it is spelled. All five spellings plus the other-file case are in the test as data, compiled and checked through the same operator the build uses, along with the boundaries: a persisted value that is not keyed by path is not the registry's business, and a path-keyed map that is not named `persisted*` is not seen, which is the one gap and is written down rather than presumed closed. Verified by doing it: adding `persistedProbe2?: { [path: string]: string }` to the files slice fails the typecheck with the key in the error message, and fails the test.

### Fixed
- **A client that hit the rate limit was told the server had broken, and in production was not told why** — exceeding the limit produced `HTTP 500` with `{"error":"INTERNAL_ERROR"}`, next to a perfectly correct `retry-after: 59` header, and under `NODE_ENV=production` the message became "Internal server error" so even the reason was gone. The limiter plugin *throws* whatever its `errorResponseBuilder` returns and the error handler reads the status off the thrown value; the builder here returned a plain `{ error, message }` object with no `statusCode`, so the handler's `429` branch never matched and it fell through to `error.statusCode || 500`. The `RATE_LIMIT_EXCEEDED` code the API documents was dead for the global limiter — nothing could produce it. The practical cost is the opposite of what a rate limit is for: a client implementing standard 429 backoff sees a 500, treats it as a server fault, and retries immediately into a server already saying stop. The builder now returns an `Error` carrying `context.statusCode`, which is what the plugin's own default does, and takes the status from the context rather than hardcoding it so a ban threshold's 403 would stay a 403. **The error handler was the other half and is the reason the message vanished.** Anything that was not a validation error or an exact 429 was relabelled `INTERNAL_ERROR`, and in production had its message replaced — including every 4xx, whose message is the only way a caller can learn what to correct and which by definition cannot contain server internals. Client errors now keep their status, are reported under the same code vocabulary `sendError` uses, keep their message in production, and are logged at warn rather than error. Observed on a rebuilt image, in both modes: `HTTP/1.1 429`, `retry-after`, and `{"error":"RATE_LIMIT_EXCEEDED","message":"Rate limit exceeded. Max 3 requests per 60s. Retry in 1 minute."}`.

- **A request that never finished arriving was never cut off** — Fastify defaults `requestTimeout` and `connectionTimeout` to 0, and 0 means no limit, so how long a single client could hold a connection was decided by whatever proxy happened to sit in front of the service. Measured against the running image rather than inferred: a POST that declared a body and then sent one byte per second was still connected and untroubled after 90 seconds, with nothing in the stack that would ever have closed it. `requestTimeout` is now 15 minutes and a dribbling request ends in a 408. **The number is deliberate and the reasoning is written beside it**, because the same knob decides how long an attacker may stall *and* how long a legitimate upload may take — it is a hard ceiling on the whole transfer, not an idle timer, and a 90 KB body sent evenly over 45 seconds was observed being cut off at 16 seconds under a 15-second ceiling. `POST /files/sync` carries a whole file base64-encoded in its JSON body up to the 100 MB body limit, and 15 minutes is 100 MB sustained at about 1 Mbit, below any link an integration host would be on; a tighter bound would mean killing large syncs that were going to succeed, which is an outage we would have caused ourselves. Two related findings are recorded in the same place. Node will not enforce a request deadline shorter than its own 60-second headers timeout, which Fastify does not expose, so values under a minute do nothing on their own — while a 90-second setting was observed ending a dribbling request at exactly 90 seconds. And **`connectionTimeout` is deliberately left unlimited**: it is an inactivity timer on the socket and cannot tell an idle attacker from a handler that is working, and a customer sync is a single HTTP request that runs for many minutes with nothing on the wire — setting it to 5 seconds was observed killing an 8-second handler mid-flight. The one case it would have covered, a client that connects and sends nothing, is already closed after 60 seconds by Node's headers timeout, which was also observed. `keepAliveTimeout` and `pluginTimeout` are now stated rather than inherited: the first has to stay above the 60-second idle timeout of the platform proxies, or the proxy dispatches onto a socket the server is closing and the caller gets a sporadic 502 with no matching server log; the second is raised to 30 seconds because a miss there is a crash loop rather than a slow start.

- **The Render blueprint could not have deployed the API, and still carried the defect the image had just had removed** — `render.yaml` built with `npm install` and started with `npx tsx api/server.ts`. All three parts were wrong at once. `api/` is a separate deployable with its own manifest and lockfile, so a root install never installs the API's dependencies and the service would have started with nothing to run. `npx tsx` is the same registry fetch at boot that the previous entry removed from the image — a devDependency pulled from the network on every cold start, at whatever version the registry currently serves. It now builds with `npm ci --prefix api && npm run build --prefix api` and starts with `node --enable-source-maps api/dist/server.js`, matching `api/Dockerfile` and `api/railway.json`, so all three deployment targets install from the same lockfile and run the same compiled JavaScript. It also pins `NODE_VERSION` to 22 rather than inheriting whatever default the platform had when the service was created, which is what the image and CI use. Verified by running the blueprint's exact two commands in a clean `node:22-alpine` container: the build emits `api/dist/server.js`, the start command listens, and `/health` answers. `CORS_ORIGINS` is still `"*"` in the blueprint and is left for a separate decision.

- **`consume_share_link` was invisible to anyone looking for it** — the generated database types carry `create_file_share_link` and `validate_share_link` but not `consume_share_link`, which the schema has defined since share-link validation and consumption were split apart. Nothing misbehaved, since nothing in the app calls it yet; the cost is that the function does not exist as far as the type checker or anyone reading the types is concerned, which is how a second implementation of something gets written. It is now declared, with the signature the schema gives it.

- **The API downloaded its TypeScript runtime from npm every time a container started, and could not boot at all when npm was unreachable** — the image ran `npx tsx api/server.ts`. `tsx` is a devDependency and the image installs with `npm ci --omit=dev`, so it was never in the image, and `npx` went to the registry to fetch it on every cold start. This is not a deduction from reading the Dockerfile: started with `--network none`, the container printed `request to https://registry.npmjs.org/tsx failed, reason: getaddrinfo EAI_AGAIN`, spent ninety-three seconds retrying and exited without ever listening. With a network it worked, and the log line said what it was doing — `the following package was not found and will be installed: tsx@4.23.9` — which is the registry's current release rather than the `^4.19.2` the lockfile pins, so the runtime interpreting the production API was a version nobody had chosen, could change under a service that had not been redeployed, and was one npm outage or rate limit away from a service that would not start. The image is now built in two stages: the first installs every dependency from `api/`'s own manifest and lockfile and compiles the API with `tsc`, and the second copies only the emitted JavaScript and the production dependencies onto a clean `node:22-alpine`. It starts with `node`. There is no compiler, no `tsx` and no `.ts` file left in it — checked, rather than assumed — and it fetches nothing at startup: the same `--network none` run now answers `/health` with HTTP 200. The image is 347 MB where it was 498 MB, and a cold start takes 0.73 seconds where it took 2.4. **Local development is unchanged and still uses `tsx`** — `npm run api` and `npm run api:dev` run the TypeScript directly as before, and `tsx` remains a devDependency. What changed is only what production runs.

  **Compiling the API for real exposed six imports that Node could never have resolved.** `tsx` strips types and runs; it does not hold code to the rules of the module system it is running under, and the API's compiler settings did not either. `moduleResolution` was `bundler`, which permits a relative import to omit its file extension and emits the specifier untouched — a promise that some bundler will sort it out later, in a service that has no bundler. Under `NodeNext`, which is what the API actually runs as, six specifiers were rejected: `../types` in `utils/files.ts` and `utils/odoo.ts`, `./env` in `src/config/index.ts`, `./supabase` and `./logging` in `src/infrastructure/index.ts`, and `./plugins` in `src/core/index.ts` — that last one a bare directory, which Node's ESM resolver does not look inside at all. Every one of them would have thrown `ERR_MODULE_NOT_FOUND` the moment it was loaded by `node` rather than by `tsx`. They now name the emitted file. In the same pass: `server.ts` opened with `#!/usr/bin/env npx ts-node`, which `tsc` copies verbatim into the compiled output, pointing anyone who ran the file directly at a package that is not a dependency of this repository and never has been; the repository had no `.dockerignore`, so the build sent the whole 2 GB working tree as context and `COPY api/ ./` would have dropped a developer's `node_modules`, built for their operating system, on top of the Linux install the image had just made; and the root `api:build` script compiled `server.ts` alone, as CommonJS, targeting ES2020, into a `dist-api` directory nothing read — it now runs the real build.

  Two things guard this going forward. `typecheck:api` runs with `noEmit`, so it proves the types are sound and nothing whatsoever about whether the code compiles into something Node can load — every one of the six imports above passed it for years. CI now also builds the API exactly as the Dockerfile does, so a specifier Node cannot resolve fails the pull request instead of the deployment. And because `/health` barely touches the application, booting it proves little: the check that the compiled image is equivalent to the old one is that both were started and asked for their OpenAPI document, and all 73 routes across all twelve route modules are present in both, identically, along with all eleven security headers `@fastify/helmet` sets. The API version is deliberately **not** bumped — no endpoint, payload or behaviour changed, and telling every correctly-deployed user to redeploy for a number that means "the contract moved" when it did not is how that number stops being worth reading. Note also what was deliberately left alone: the image does not set `NODE_ENV`, so it runs as `development` unless the platform sets it, which is what gates CORS to permissive and exposes `/docs`. Setting it here would have quietly turned CORS deny-by-default for every existing deployment, and that is a decision to take on its own, not one to smuggle in under a build change.

- **Renaming a folder works again when no vault is the active one** — schema 90 made the vault a required argument of `rename_folder_files`, for a good reason: it had defaulted to "every vault", so one call could rewrite matching paths across every organization in the database. But all three places that call it pass the currently active vault or nothing, and the active vault is unset until something sets it — it starts unset, and a profile that has connected vaults but has never switched between them still has it unset. Those users got "A vault is required" where the rename had previously worked. Leaving the argument out is allowed again and no longer means "everywhere": the vault is worked out from the folder being renamed, within the caller's own organization and nowhere else, which is exactly the authority they already had, since vault access in this schema is organization membership. If the same folder path exists in more than one of their vaults the rename is refused and says so, rather than picking one.

- **Editing a configuration's description or tab number now shows that something is happening** — those two fields are edited in place on the configuration row, and committing one writes into the SOLIDWORKS file and reads it back to confirm, which takes a moment and longer on the first edit after the app starts. Nothing on screen said so. The row sat unchanged, so the edit looked either instantaneous or ignored, and people retyped it. A spinner now appears on the row for as long as the write is running. The same gap had a second consequence that was harder to see: checking a file in is supposed to be blocked while its metadata is being written, and these two editors were not registering their writes anywhere the check-in guard could see them, so a check-in could start on top of one and upload the file mid-write. Every metadata write now registers itself, and it registers which configuration it is writing to, so the guard knows the file is busy and the row knows it is the one busy.

- **Retitling a part that has configurations wrote the new title into its configurations and not into the part itself, and called that confirmed** — this is the ordinary case, not an edge one: any part or assembly with more than the one default configuration, edited from the datacard or settled during check-in. The write planner built one group per configuration and none for the document's own property bag, and the file-level fields were redirected into the base configuration to be checked there. The read-back duly found them there and reported `verified`, which is the one outcome that stops a retry and that check-in then forgets. Reproduced end to end on a three-configuration part: retitle it and clear its revision, and afterwards the configuration holds `Description: "Viton o-ring", Revision: ""` while the document's own bag still holds `Description: "Original o-ring", Revision: "A"` — no mark, no retry, and a title block reading `$PRP:"Description"` showing the old text for ever. It also put two parts of BluePLM into open disagreement, because Scan for Divergence reads a file-level field from the document's own bag unconditionally and would report as divergent what the write had just reported as confirmed. The planner now writes the document's own bag first and confirms each field where it was written, and the redirection mechanism is gone entirely rather than corrected — it was the only way two parts of the app could hold different beliefs about where a value lives. Configuration-only edits are unaffected and still open the document once: an inline tab or description edit says which one address it is establishing, so the number it carries along to rebuild `Number` is no longer mistaken for a file-level edit.

- **Check-in could send a value to BluePLM that it had never confirmed was in the file** — before promoting your pending edits to the database, check-in writes whatever the datacard could not and then asks, address by address, which of them the file now holds. Two functions a dozen lines apart disagreed about what "no record for this address" meant: the one that decides what still needs writing read it as *owed*, and the one that decides what may be promoted read it as *confirmed*. The second runs last, so the value went to the database and the pending edit was cleared, with nothing anywhere saying the file had not taken it — in direct contradiction of the rule the module states about itself. Four routes reached it, all reproduced and all now covered: a document whose configuration list could not be read at all (a failed read and an empty list were the same value, so check-in planned a file-level write off a failure and confirmed it); a pending edit naming a configuration the document no longer has; editing the file-level Description together with the base configuration's own; and a file-level tab number on a multi-configuration document, which produced no write at all and is reachable from Sync Metadata. An absent record is now unconfirmed, and — the actual repair — every address check-in set out to write is now guaranteed to come back with either a real verdict or an explicit "not attempted", so absence is no longer a state the promotion step can encounter.

- **A write that skipped a configuration reported every configuration as confirmed** — writing several configurations goes to SOLIDWORKS as one batch, and the service could name a configuration it had failed to enter in a prose list of errors while still returning overall success. BluePLM counted such a configuration as unaccounted for, logged a warning, and then let the read-back settle it — and the read-back cannot, because a configuration falls back to the document's values when it holds none of its own, so a configuration that was never written reads back exactly like one that was. Proven with two configurations and one skipped: both reported confirmed. Tightening the comparison was not available, because a property that is genuinely absent is a real state for a file last touched by an older service or by SOLIDWORKS itself. The durable fix is in the service: both write paths now report acceptance **per configuration**, naming the ones they could not enter, so BluePLM no longer has to infer it. Anything left unaccounted for is now marked unconfirmed and will be retried instead of being read back into a false confirmation. In the same function, a write that named no address at all — the shape Sync Metadata uses for the document's own bag — could fail with `the file is read-only` and contribute no verdict whatsoever, so the push logged "confirmed in the file" over a file it had not written; such a failure is now carried and reported. **This raises the required SOLIDWORKS service version to 1.20.0**; update it from Settings if you are prompted.

- **Checking in from the command line no longer runs on top of a metadata write that is still going** — the guard existed and worked, but only in the user interface, where it greys out a button. `blueplm ci` does not press buttons. Typing it while an inline configuration edit was still writing started a second write against the same document, with neither aware of the other. Check-in now consults the same register the buttons do, waits for the write to finish, re-reads the file afterwards so it sees the marks that write recorded, and declines with a clear message rather than proceeding if the write is still running after two minutes. It also registers its own write there, so the traffic is stopped in both directions. Separately, an empty pending-edit object counted as an edit and cost a file the fast path it should have taken.

- **A check-in that could not confirm what it saved now says so** — the per-address marks and the row markers were the only record: check-in could promote sixty-eight unconfirmed addresses to the database and still finish on a green "Checked in 1 file". The toast is now a warning that says how many fields could not be confirmed and what to do about them, and the count is carried in the command's result for anything reading it.

- **Clearing a configuration's description no longer refills it from the file's** — after a datacard edit, the file-level values are copied down into the active configuration so that `$PRP:` references in drawing title blocks resolve. That copy treated an empty configuration description as a missing one and overwrote it, which undoes the whole point of writing a cleared property as empty rather than deleting it: "this configuration deliberately says nothing" was expressible for one release and then immediately overwritten by the file-level text. A configuration now keeps whatever it holds, empty included; only a configuration with no property of that name at all, or one holding a reference that resolves elsewhere anyway, is filled in. The copy's own success or failure used to be discarded and is now reported.

- **"Sync Metadata" deleted the tab number out of every configuration of almost every file you ran it on** — the command writes BluePLM's item number and description into a part or assembly, and the number it writes into each configuration is the base number with that configuration's tab on the end. It read those tabs from the list of edits waiting to be checked in, which holds only the configurations you have touched during this checkout and is empty for a file you have not edited — the ordinary case, and the case in which running "Sync Metadata" is most obviously harmless. Every configuration therefore came out with no tab: `Number` was written as the bare base number with the tab stripped off it, and `Tab Number` was left out of the write entirely, so the two properties in the file then disagreed about a tab that no longer existed in either. On the 68-configuration part this was found on, one run removed 68 tab numbers, silently, and reported a successful sync. The file was the only remaining copy of them for any configuration whose tab had been read out of the document rather than typed into BluePLM. The command now reads each configuration's tab the same way the rest of the app does — your edit laid over the recorded value — and a configuration BluePLM holds no tab for keeps the one the document already has rather than being emptied, because BluePLM knowing nothing about a configuration is not the same as knowing it has no tab.
- **The last two writers that made up their own rules now use the same one as everything else** — the release notes above describe a single shared decision about what a metadata edit writes into a SOLIDWORKS file, and a single shared step that reads the file back to confirm it. Two writers were never moved onto either: "Sync Metadata", and the tab and description cells you edit directly on a configuration row. Both built their properties by hand, and both dropped any field that came out empty, so clearing an item number and then touching a configuration left the number you had deleted sitting in the file while the database moved on — and "Sync Metadata" went further, returning without writing anything at all when the item number, description and revision were all empty, which made emptying a file the one edit it could never carry out. The configuration description cell had the strangest version of it: it wrote that configuration's tab only if the file had an item number, so whether a tab survived depended on a field in a different part of the datacard. Neither writer read the file back, so neither could mark a field as landed or not landed, and neither's failures reached the markers in the file list. Both now hand the same planner the same question the datacard and check-in ask it, and both confirm what they wrote. **The cost is visible on "Sync Metadata" for parts with very many configurations**: confirming a write means opening each configuration rather than sending all of them at once, which on the 68-configuration part takes about four seconds instead of one. It is an explicit command with a progress bar over a selection you made, so it can afford that; the inline cell edits touch one configuration and are unchanged.
- **Two more places showed the revision you had just replaced** — the entry above about exports covered the item number and the description; the revision was left reading the server's value on the adjacent line, in the same files, and the same edit. Exporting a STEP, an IGES, an STL or a drawing pack after bumping a revision in the datacard and before checking it in put the old letter in the filename and in whatever the pack's title block was built from, while the metadata table CSV beside it had the new one — so two exports of the same file, produced a minute apart, disagreed. The Item Browser had the matching half-conversion: it grouped files under the item number you had just typed and then labelled the group with the description and revision from before the edit, so a single row contradicted itself. The rows under an expanded drawing and the file search did the same with revision. All of them now read it the way the cell you typed it into does.
- **The check that was supposed to stop the entry above from happening again caught one shape out of ten** — it was two regular expressions looking through the source for a value read from the server followed by `||` followed by the word for the pending edit, within 120 characters. Run against ten ways of getting this wrong it caught one: the exact one it was written for. It missed `??` in place of `||`, a conditional, the same pair written further apart, a server row that had been unpacked into variables first, one that had been given a shorter name first, and each of those again on the per-configuration maps. Most importantly it missed a read with no pending side mentioned anywhere near it — which is what the export was doing with the revision, live, while the check reported no problems, because a careless conversion does not leave the thing it forgot lying next to the thing it did. The check now parses the code rather than searching it, and asks a different question: not "are these two read in the wrong order" but "is this field read from the server row at all", with the places that legitimately want the server's value named one at a time with the reason written beside them. There are 13 such files and 80 such reads, all of them deliberate — check-in and the drift comparison want the value the server holds, the SOLIDWORKS panel is asking whether your file disagrees with the database, a deviation records the state of a file that has been checked in, the `metadata` command prints both sides on purpose. Anything else fails until somebody writes down why it is not a bug, which is the opposite of the old arrangement, where a new mistake went unnoticed unless the check had predicted its shape in advance. The ten shapes are in the test, run against the new check and against the regexes they defeated, so the claim is verified rather than asserted.
- **Every extension install that failed reported "extensionId is not defined" and logged nothing** — the handler that installs an extension from the store takes the store's download id, and two lines inside it still named a variable that a rename had removed. One sits in the branch that handles the store answering 404; the other sits in the handler's `catch`, which runs for **every** failure — a download that timed out, a package that is not a valid zip archive, a manifest missing its version, a disk that refused the write. Reaching either line threw a `ReferenceError` before it could say anything useful, so the install dialog showed the name of a missing variable where the reason belonged, and the log line that would have recorded what actually went wrong never ran. Installs that worked were unaffected, which is exactly why this lasted: nothing on the working path touches those two lines, so the feature looked healthy right up to the first failure, and then explained nothing about it. Both lines now name the extension you asked to install, and the real cause reaches the dialog and the log. The extension host's loader had a quieter version of the same problem — it stored the caught exception object where a message string belongs, so an extension that failed to load or activate recorded `[object Object]` as its error; it now records the message.
- **The whole Electron side of BluePLM had never been type-checked** — `npm run typecheck` is the gate this project treats as authoritative before a release, and it ran the compiler against a configuration that includes `src` and nothing else. Everything in the main process — window management, the IPC handlers, file operations, the SOLIDWORKS process lifecycle, extension hosting — sat outside it and shipped unchecked. A second configuration covering that code did exist, but it omitted the language target, so the compiler assumed a JavaScript version two decades old and buried the real findings under complaints about iterating a `Map` — noise that made the check not worth running, which is how the two lines above survived to reach users. The target now matches what Electron actually runs, which removed 14 of the 26 complaints as the fabrications they were. The remaining 12 were all genuine and are all fixed: the two above, four in the extension loader that were the `[object Object]` defect, and six in the file handlers that were type-safety gaps rather than misbehaviour — a hashing routine that assumed a stream chunk is always binary, and two batch-delete paths whose check against the working directory the compiler could not prove safe. `npm run typecheck` now covers both halves of the app and `npm run build` runs it, so main-process code is behind the same gate as everything else.
- **The check that keeps a diagnostic away from your vault files could be talked out of it three ways** â€”— `RegressionFixtureGuard` is what the write probe, the fixture sweeper and the backup-and-restore path all ask before they touch a file, and it is the only thing standing between a diagnostic and a production SOLIDWORKS document. Three of its answers were wrong in the direction that permits a write, and all three were reproduced on Windows before being fixed rather than argued about from the source. It walked up from the file looking for a junction or a symbolic link and stopped the moment it reached the fixture folder, so it never asked what the fixture folder itself was — a junction standing in its place, which is the single thing that redirects every fixture at once, was waved straight through, and so was one anywhere above it. It resolved a relative path against the working directory, so `genuine.SLDPRT` was inside the fixture folder or outside it depending on where the service had been started from; the same string got both answers in the same process. And it relied on Windows collapsing `..`, which Windows does not do for a path beginning `\\?\` — it hands that path through untouched — so with the fixture root spelled the same way, `\\?\...\00 - REGRESSION TESTS\..\..\real-parts` was accepted with the `..` still in it. Two other suspicions were checked and were not defects: an 8.3 short name and a path deeper than the guard will walk were both already refused, though the short name was refused by accident, via a .NET Framework behaviour that .NET itself has since dropped. Looking for the reason those three got through turned up a fourth: the code that read a path's attributes asked `File.Exists` first and treated "no" as "nothing suspicious here", and `File.Exists` also says no for something it is not allowed to look at — so the branch written to refuse anything unreadable could not be reached for the case it was written for. The guard has been rebuilt around proving containment rather than comparing strings. It now requires an absolute, already-canonical path and refuses to resolve anything: no `..`, no `.`, no short names, no `\\?\`, no relative paths, no name that Windows would silently trim. It compares component by component, so a sibling folder called `00 - REGRESSION TESTS ARCHIVE` cannot pass as the root by sharing its opening characters. It inspects every directory from the drive letter down to the file, the fixture folder included, and refuses if any of them is a junction or a symbolic link. Anything it cannot read, it refuses. And it now says which rule a refused path broke instead of offering the same sentence for every refusal. Resolving what an operator typed on the command line is now done by the command line, before the guard sees it, which is the one place a working directory is a legitimate part of the question. **Three things the guard was never asked came out of reviewing that work.** The diagnostic's help text says it is read-only unless `--allow-write` is passed, and it was not: before it looked at that flag at all it swept the folder it had been pointed at, deleting temporary and backup files throughout — and with no test folder configured, that folder is your live vault. A plain read-only run now reads, moves, restores and deletes nothing; the sweep happens only when writing has been asked for, which is also the only time it is any use, since its purpose is to finish the cleanup an interrupted write run left behind. The pattern `*.bak` has been dropped from what it removes, because that is an extension people use for their own backups and not one SOLIDWORKS leaves lying around. Two of these diagnostics running in the same folder could destroy the only good copy of a file: each treats any backup it finds as wreckage from a dead run, so the second would restore the first's backup over the file the first was midway through writing and then delete it, leaving the first with a changed file, no backup and a hash mismatch it could not repair. A backup now records the process holding it, and a backup whose owner is still running is left alone; only one whose owner is gone is treated as wreckage. And the guard accepted `C:\` as a test folder — a perfectly well-formed path naming a volume and nothing else, which its component-by-component containment check then compared nothing against, authorising the entire drive. A folder too broad to confine anything is now refused outright, and the refusal names the folder rather than the file, because the file was never the problem.
- **A drawing's references have never been read without SOLIDWORKS, and the fallback is what you were seeing** — the previous release corrected the flags BluePLM passes when it asks the Document Manager library for a file's references, which is what made the headless read work at all. What that release left in place is the reason it went unnoticed for so long: a read that could not be answered and a file that genuinely has no references came back as the same empty list. Every drawing therefore looked like a drawing with no model, and BluePLM quietly escalated to opening the file in SOLIDWORKS to find out — the windows appearing and disappearing were the symptom, and the empty list was the cause. The two are now different answers. A read that no method could answer says so, and BluePLM tries the cheaper routes in order — a document already open in SOLIDWORKS, then the Document Manager library, then asking SOLIDWORKS for a closed file's dependencies without opening it — before anything is allowed to open a window, which only a request you made may do at all. If it still cannot tell, the expanded drawing now says the references could not be read, with a retry, instead of showing you nothing and letting you conclude there is nothing there. The broken-reference flags the library returns alongside the paths are no longer discarded, and the search for a usable version of the library's document interface now starts where the reference calls first appeared rather than six versions later.
- **Every drawing of a part with many configurations inherited placeholder values** — pulling a drawing's item number and description means reading them from the model the drawing documents, and a model with configurations holds a different set per configuration. BluePLM had no way to know which one the drawing showed, so it guessed: the configuration called "default", failing that "standard", failing that whichever happened to be first. On a real o-ring part with 68 configurations there is no "default" and no "standard", and the first one is `XXX` — a template whose item number is literally `BR-100635-XXX`. All 11 of its drawings inherited that, and every one of them reported a successful sync. The Document Manager library has known the answer the whole time: each drawing view records the configuration it shows, readable without SOLIDWORKS running. BluePLM now reads it and uses it, and the guess is gone rather than kept as a fallback — if the drawing does not name a configuration, or names one the model does not have, BluePLM inherits only the model's file-level values and says so in the log, which is the honest answer and is never a placeholder. Expanding a drawing in the file list shows the same real configuration next to each referenced model.
- **BluePLM could force-kill the SOLIDWORKS you were working in, and on 6 August it did** — a watchdog ran every five seconds and terminated any `SLDWORKS.exe` whose main window was titled `__wglDummyWindowFodder`, sparing only the instances BluePLM had launched itself in that session. That title belongs to a scratch window OpenGL creates, and a SOLIDWORKS that is starting up, busy, stuck or minimised to the tray can be showing it, so it says nothing about who started the process or whether someone is working in it. A user lost her session to this: her SOLIDWORKS was the only one running, BluePLM had read her drawing's views through it seconds earlier, and it was killed with `taskkill /F` — no prompt, no chance to save. A recent and otherwise correct change made the exposure worse, because BluePLM now refuses to start a second SOLIDWORKS when one is already open, which frequently leaves it with no instance of its own to spare and every SOLIDWORKS on the machine a candidate. The criterion is now provenance rather than appearance. BluePLM writes a record to disk when it launches an instance, identifying that process by its process ID **and** its start time, and only a process matching such a record — whose start time still agrees, and which no running BluePLM service is still using — may be cleaned up. A recycled process ID cannot inherit someone else's claim, a process BluePLM did not start has no record and is unreachable by this code at any window title, and anything that cannot be identified with certainty is left running. Cleanup is now a request to close rather than a kill, so an instance holding unsaved work asks you what to do instead of discarding it, and one that refuses to close is left alone and logged. Because the record is on disk it survives a crash, so an instance stranded by one is recognised as BluePLM's on the next launch and cleaned up then — but instances stranded by versions before this one have no record and will never be touched, so close any leftover hidden SOLIDWORKS yourself. The log now records each process's start time, how ownership was decided and why the watchdog acted or did not. **Two ways that record could name the wrong process have since been closed.** The service announces a launch by writing a line to its error stream, and BluePLM read those announcements one raw chunk at a time; a pipe does not deliver whole lines, so `LAUNCHED_PID=23456` arriving split after the third digit was read as process 234. Usually that means the real instance is never recorded and the watchdog can never clean up the leak it exists for, but a truncated number that happens to match another running SOLIDWORKS produces a record for **that** process — complete with a start time copied off it, which is what made the record look self-certifying — and the watchdog would then correctly act on a process BluePLM never started. Announcements are now assembled into whole lines before being read, every announcement in a chunk is read rather than only the first, and a truncated release notice can no longer strand a record as permanently in use. Separately, a start time read off whoever currently holds a process ID is not evidence of anything, so a record is now written only when the process can be shown to have started after BluePLM asked for one and within the time a launch takes; a process that was already running, or one Windows will not report a start time for, is left unrecorded rather than claimed. On the service's side, the list of SOLIDWORKS processes taken immediately before a launch — gathered for exactly this purpose — was being consulted only on a fallback path, while the main path took whatever process SOLIDWORKS reported and marked it as BluePLM's regardless. Because that also decides whether BluePLM may hide the window, attaching to your session at the wrong moment would have hidden it. The two lists are now compared on every path, and a process that was already in the first one is treated as your session: not recorded, not hidden, not touched.
- **A metadata write that failed left the value behind for check-in to send anyway** — with the in-memory copy above gone, the list of changes waiting to be checked in is the only record that you edited anything, and check-in sends whatever it finds there. So a write that never reached the SOLIDWORKS file — the file was read-only, SOLIDWORKS refused it, the service was not running — left your value sitting in that list, and the next check-in put it in the database as though the file had taken it. That is the same file-versus-database divergence this release is otherwise closing, arrived at from the other direction. **Your value is now kept and marked instead of being either discarded or promoted in silence.** An item number or description that is not in the file carries a warning marker in the file list beside the cell you typed it in, with a retry button; the marker's tooltip says whether the value is definitely not in the file, or merely could not be confirmed, and on a part with many configurations it names the configurations concerned rather than rounding them into one answer. The mark survives closing and reopening BluePLM, because a value the database has and the file does not is not a fact about this session. An intermediate release discarded the edit in this situation, on the grounds that losing a keystroke was better than a silent divergence; that trade no longer has to be made, and the revert is gone rather than kept as an option.
- **A write to a SOLIDWORKS file now has to prove it landed** — the service reports whether the API call it made returned successfully, which is not the same thing as the value being in the file: a property SOLIDWORKS refuses on type grounds, a configuration that declines the value, a save that never reaches disk, all report success. Every metadata write now reads the document back and compares what it finds against what it asked for, per field and per configuration, before anything is recorded as done. There are three outcomes rather than two, and the third is the point: the value is in the file, the value is definitely not in the file, or nobody could tell — the file was locked, the service stopped answering — which is marked distinctly and never as either of the others, because a retry is the whole remedy for the second and may be pointless for the third. The read-back is one call per write regardless of how many configurations it touched, and on this machine's own logs that call costs about 29ms warm against 60ms for the write it confirms, so it is on for every write with no way to switch it off. The previous release could do this only in the `scan-divergence` diagnostic.
- **Check-in writes what the datacard could not, before it promotes anything** — check-in used to promote your pending edits to the database and clear them, trusting that the datacard's own write had already put them in the file. It now writes the fields that are not confirmed in the file, confirms them the same way, and only then promotes. Fields already confirmed are not rewritten, so a check-in of files you did not edit costs nothing extra. Values that still could not be confirmed **are promoted anyway** — the value is yours and the database is where it belongs, so withholding it would lose the edit rather than protect it — but the file keeps the mark saying so after the pending value has gone, which is precisely what the old behaviour could not express. A check-in is never blocked by SOLIDWORKS being closed; the unwritten fields are marked as not attempted instead.
- **Clearing a metadata field reaches the file** — clearing the item number, description and revision from the details panel all at once wrote nothing at all, because the panel built its list of properties from the values that were left and returned early when there were none. So the one edit that could not reach the file was the one that emptied it, and the file kept the values you had deleted. All the write paths — the details panel, the configuration editors and check-in — now build their properties the same way, from which fields you touched rather than which came out non-empty, so a field cleared to nothing is written as an empty property. **The other half of this has now landed too**, in the entry below: the property stays in the file, visible and empty, which is both what a title block wants and what SOLIDWORKS' own dialog shows after you clear a field rather than delete it.
- **A field you clear now stays in the file as an empty property instead of being removed** — a drawing's title block reads a property by name, `$PRP:"Description"`, so removing the property does not blank the annotation: the link breaks, and what stands in its place is the raw `$PRP:` text or the value the file was last saved with. Removing it also makes a field you cleared indistinguishable from one nobody ever filled in, which is a difference BluePLM now depends on when it reads a write back to confirm it landed. The service treated an empty value as an instruction to delete in **four** places — writing a document's own properties, writing one configuration's, the batch write that does every configuration of a part in a single open, and the SOLIDWORKS fallback, which called `Delete2` — and all four now write the empty value through. Clearing an item number on a configuration clears the file-level copy of it as well, rather than leaving behind the number you just deleted. **The delete rested on a claim in the code that the Document Manager library could not be relied on to store an empty string, and that claim is wrong.** Measured on a part, an assembly and a drawing, at both file and configuration scope: `SetCustomProperty` takes an empty string over an existing value, `AddCustomProperty` returns true for a new property carrying one, and a fresh handle reads the property back as present and empty in every one of those cases. The only call that fails is `SetCustomProperty` on a name the file does not have yet, which fails that way for any value and is why creating a property goes through `AddCustomProperty` in the first place. **The service can now also report a property that exists and is empty**, which it could not: the read dropped every empty value, so a cleared field and an absent one arrived at the app as the same answer, and verification had no way to tell them apart. Removing a property outright is still possible and is now asked for by name, through a new `deleteProperties` command, rather than being what an empty string happens to mean; asking to remove one that is not there is reported as a no-op rather than a failure. That an ordinary write can no longer reach either delete routine is asserted by walking the compiled call graph, so an edit that reintroduces it fails the build rather than a title block.
- **Six defects in the write-state machine above, two of them proven by running it** — the marker that says a value is not in your file only helps if it is there when it should be and absent when it should not, and it was neither. **Renaming or moving a file threw the mark away and kept the value.** Everything BluePLM remembers about a file it is holding for you — your pending edits, where a pasted file was copied from, whether the file has actually accepted those edits — hangs off the file's path, and a rename has to move all of it at once. The list of things to move was written out by hand, and the record of what the file accepted was added beside the pending edits and never joined it, so renaming a file kept your value and orphaned the record. What made that serious rather than untidy is the mark check-in leaves behind: it says the database has taken a value the file may not have, and it is set only after the pending value has already gone, so nothing else recorded the doubt. After the next reload the value read as confirmed. Any of about a dozen paths reached it — rename, move, drag and drop, paste. Adding the missing name to the list would have been the third time; instead there is now one declared list that the rename, the saving and the reloading all derive from, so a new one cannot be added without all three taking it, and a test fails if the app grows a path-keyed record that is not on it. **A write that landed nothing could report itself confirmed.** Verification read a configuration's properties with the document's own properties showing through underneath, which is right for displaying a value and wrong for deciding whether a write happened: on a part whose configuration write did nothing at all, a leftover file-level item number from an earlier release satisfied the check, and the item number was recorded as confirmed — the one state a retry skips and check-in forgets — while the configuration's full number, the one a drawing title block reads, was never written. The same fallback made **clearing one configuration's description fail permanently**: the file-level description, which is exactly what clearing it is meant to reveal, read as a value that had refused to go, so every check-in of that file rewrote it, paid for the read-back, failed again and promoted the value marked as unconfirmed, forever. A configuration is now judged on what it holds and nothing else, which is the definition the drift scan already used — the two disagreed about what a configuration contains — and the view that includes the document's properties is still there for displaying a value, under a name that cannot be mistaken for the other. **The mark did not survive you editing the field again**: after a check-in promoted a value it could not confirm, typing in that cell dropped the record of the promotion, so if the retry failed too, nothing was left saying the database held something the file might not. Whether the database has your value is a fact about the world rather than about the last attempt, and it now persists across every retry until the file is confirmed to hold it. **A write instruction that named fields but carried nothing to write** left those fields with no verdict at all — no plan produces that shape today, and it is now recorded as not attempted rather than passed over in silence. And the state meaning "a write is happening right now" was in the stored vocabulary with nothing that could ever store it, alongside a claim about what happens if BluePLM is killed mid-write that was therefore untrue; it is now a display state the type system will not let anything record, and an interrupted write comes back as an edit still owed to the file, which the next save or check-in writes and confirms.
- **Four more places showed the item number you had just replaced** — the previous release corrected the exports; these are the ones that only became visible once the in-memory copy was removed. The command palette matched your new number and then labelled the result with the old one. The RFQ file picker did the same, and adding a file to an RFQ recorded the old number on the quote line — the least clear-cut of these, since the line is a durable record other people see, but a line built from the number you have already replaced goes permanently stale the moment you check the file in, and nothing would ever correct it. A generated inspection sheet took its report name and its number, revision and description tokens from the server's row while the table beneath them was your unsaved work. The reference diagnostics panel filtered assemblies by your number and labelled them with the server's. All four now show the same value the file list does.
- **Creating an RFQ has failed on every correctly installed database** — the New RFQ dialog asks the database for the next RFQ number before it inserts anything, and the function it asks for, `generate_rfq_number`, was not created by any schema module. It existed in the old single-file `schema.sql` and was dropped on the floor when that file was split into modules; the two places that still named it were the reset script and the verification script, and the verification script had been reporting it as missing all along. Nothing caught it in the app either, because the call had been cast to silence the type error that the missing function produced. Creating an RFQ therefore got as far as "Failed to create RFQ" and no further. The function is back in `30-supply-chain.sql` and still issues `RFQ-<year>-<sequence>`, so numbering continues from wherever an existing database left off rather than restarting. It differs from the original in how the number is reserved: the sequence is now consumed from a per-organization counter instead of being computed as one more than the highest RFQ on file. The number is handed out in one transaction and the RFQ is inserted in a later one, so the old approach gave the same number to everyone who asked before the first person had finished — with twenty sessions racing it produced the same number 500 times out of 500, where the counter produced 500 distinct ones.
- **The drift scan called values recoverable that BluePLM never owned, and read a total wipe as no loss at all** — `scan-divergence` arrived in the last release to measure how far the database and your SOLIDWORKS files have drifted before anything sets about repairing them, and the repair step it feeds is still to come. Nobody has run it against a real vault yet, which is lucky, because several of its judgements were wrong in the direction that turns into bad writes later. The first: a configuration whose file carries a `Description` — which SOLIDWORKS configurations routinely do, for reasons that have nothing to do with BluePLM — was reported as a value the database had lost and the file still held, on every file, including files that have never used BluePLM's per-configuration descriptions at all; `Suffix` and `Tab` did the same for the per-configuration tab. A repair acting on that bucket would have copied the file's own properties into BluePLM's records and called it a restoration. A value is now called recoverable only when the row demonstrably once recorded that field **and** the file holds the value under the key BluePLM itself writes, and everything else the file has that the database does not is reported in a new section of its own, as needing a decision, with the reason it could not be attributed — on most vaults that will be the large number, and it is not a repair queue. The second was the opposite failure: a check-in that sent an empty set of configuration edits left the row carrying an empty configuration map, which is the complete version of the erasure described below, and the scan read an empty map as a file that had never used configurations — so it reported no loss and kept the file out of the wipe count, meaning the more thoroughly a file had been wiped the more likely it was to be reported as untouched. Whether the map is there is now what counts, not how much is in it, so a map that exists and holds nothing is a file that lost everything. The third would have put the wrong string in the right place: an item number lives in a SOLIDWORKS file twice, as the base and as the base with the configuration's tab appended, and the scan recorded the second where a repair would read the first, so `BR-100-265` would have been written into the field that holds `BR-100`. Every finding now carries the value a repair may actually write, separately from what the file reads as, and says so plainly when there is no such value rather than offering the nearest thing. Four smaller corrections came out of the same pass. A row and a file holding the identical text under an unexpected property name were reported as disagreeing with one another. The count of missing configuration entries included every configuration of every file that has no configuration map, which on a vault that has never used the feature is every configuration in it; those files are now counted and named as excluded instead. A drawing's own item number, which is a copy of its parent model's, was eligible to be promoted into the database as though the drawing were where it came from. And an item number or description that is in the file and not in the database is no longer called recoverable for parts and assemblies either — BluePLM is where those are allocated and authored, so a value only the file has is someone's SOLIDWORKS-side edit, which is your decision and not a repair. The scan is unchanged in the one respect that matters most: it still cannot write. It reads the database, opens documents read-only, and its only output is the report. The report's version number has gone up, so the repair step will refuse one produced before this fix.
- **Checking in one edited configuration erased every configuration you had not touched** — a part with 68 configurations kept its per-configuration tab numbers and descriptions in a single map on the file's row. Check-in sent only the configurations you had edited during that checkout, and the database merged the incoming properties one level deep, so "here is configuration `AS568-014`" was read as "here are all the configurations" and the other 67 were dropped from the row. It was silent, it happened on the success path, and the only reason it is recoverable is that the wipe destroyed the database's copy and not the SOLIDWORKS file's. Two things changed so that neither half can cause it alone: check-in now sends the complete map — everything already recorded, with your edits laid over it — and the database now merges the per-configuration maps entry by entry rather than replacing them. A new client is therefore safe against a database that has not been updated yet, and an old client is safe against one that has. **This release does not repair rows that have already lost configurations**; run `npm run scan:divergence` to see how many there are, and a later release will repair them.
- **"Sync Metadata" called a part-written file a success** — writing BluePLM's item number and description into a part with many configurations reports, per configuration and per property, what actually landed. None of it was read. A write that reached 12 of 68 configurations was reported as done, and so was one where the configurations could not be opened at all after the file-level properties had been written. Both now report the failure, name the configurations that refused the write, and say how many there were.
- **Exports used the item number you had just replaced** — three places read the value the server has before the edit you had made, so between renumbering or retitling a file and checking it in, they produced the old one: exporting a drawing to PDF or DXF, which put the stale number in both the filename and whatever the title block was built from; exporting a single configuration, which built the full item number on the old base so the tab was appended to the wrong root; and the metadata table CSV, whose whole content is those values. All three are things you hand to someone else, so the wrong number left the building. The same three read the per-configuration tab map by taking the configurations you had edited *instead of* the ones already recorded rather than laying the first over the second, so exporting a part after changing one configuration's tab looked the tab up in a map that contained only that configuration. None of this was visible, because editing metadata also wrote the value into the app's in-memory copy of the server row, which made reading either one give the same answer. That copy is being removed in a later release; these are corrected first so that removing it cannot turn them live.
- **A field you cleared no longer comes back** — clearing an item number, description or revision and then looking at almost anything other than the cell you cleared it in would show you the old value again. Roughly thirty places each decided for themselves how to combine your edit with the server's value, five different ways, and three of those five could not tell "the user deleted this" apart from "the user has not touched this" — so they fell back to the value you had just deleted. There is now one rule, in one place: a field you edited wins, including a field you edited to nothing. A cleared field reads as empty everywhere, and an empty server value reads as absent rather than as something you chose.
- **Search, sorting and filtering ignored your unsaved edits** — searching the file list, the command palette and the browser's own filter all matched against the server's item number and description, and sorting the Item Number, Description and Revision columns ranked rows by the server's values while the cells beside them displayed yours. Renaming a part and then searching for the new name found nothing. All of them now read the same value the cell shows. This also covers the details and right-hand panels and the assembly BOM resolver, which displayed server values next to cells showing edited ones.
- **Following the database install guide produced a database where check-in could never succeed** — `supabase/README.md` gave the module order as 10 → 20 → 30 → 40 → 60 and described everything after 10 as optional. It left out `15-inspection.sql`, which creates the two tables `checkin_file()` reads and writes on every single check-in regardless of file type, and left out `50-extensions.sql` altogether. Nothing objected at install time, because PostgreSQL does not resolve table names inside a function body until the function actually runs, so a fresh install looked complete and then failed every check-in with `relation "inspection_characteristics" does not exist`. The documented order is now `core → 10 → 15 → 20 → 30 → 40 → 50 → 60`, module 15 is marked required rather than optional, and the guide now distinguishes the dependencies that fail loudly at install time from the ones that only surface on first call. Existing databases are unaffected; this corrects documentation and changes no schema.
- **A Node version bump silently switched off 25 tests, and would have done it again** — `src/lib/network.ts` read `navigator.onLine` at the moment it was imported. `navigator` is a browser global that Node only gained in v21, so on Node 20 the module threw while loading, and the two suites that reach it — the metadata divergence report and the write plan — failed to *import* rather than failing an assertion. That is the quiet kind of failure: nothing said a test was wrong, 25 tests simply never reported, and the count at the bottom of the run was smaller than it should have been in a way nobody had a reason to notice. The read is now guarded exactly the way the `window` event listeners four lines below it always were. In the renderer `navigator` is always defined, so it reads precisely as before and nothing about the app's behaviour changes; anywhere else it assumes online, which is the state the renderer starts in anyway and which the first `offline` event corrects. Confirmed on Node 20 in a container: those two files go from failing to import with no tests run at all, to 25 passing.

## [3.24.0] - 2026-08-04

### Added
- **`scan-divergence` — find out where BluePLM and your SOLIDWORKS files disagree, without changing either** — a read-only scan that walks the vault, reads every part and assembly through the Document Manager library, and reports how the database and the file differ on the fields BluePLM owns: item number, description, revision, and per-configuration tabs and descriptions. It answers four questions. How many files record fewer configurations than the file actually has, which is the fingerprint of check-in replacing the whole configuration map instead of merging into it. For every value the database has lost, whether the file still has it — **recoverable** — or whether neither side does, which is **unrecoverable** and is listed file by file, because a value created through BluePLM before the property-type fix could fail to reach the file at the same time as it was being wiped from the database. Which values the two sides both hold and disagree about, with both versions shown, since only a person can decide those. And how long one read-back of a file costs, including a part with many configurations, which is the number that decides whether every future write can afford to verify itself. Run it with `npm run scan:divergence` while the app is running and you are signed in, or type `scan-divergence` in the app's terminal. It writes a summary you read and a JSON report a later repair step can act on, both into the log folder. It cannot write to your files, your vault or the database — documents are opened read-only, the database is only ever queried, and files under the regression-test folder are hashed before and after to prove their bytes did not move.
- **Pick which SOLIDWORKS version BluePLM uses** — on a machine with more than one release installed, BluePLM now asks which one you actually work in the first time it starts, and remembers the answer. You can change it later under Settings → Integrations → SOLIDWORKS; switching restarts the SOLIDWORKS service so the choice takes effect immediately.
- **Hide a folder from non-admins** — an admin can right-click a folder and hide it, which takes it out of the file browser, the sidebar tree, search results and the Item Browser for everyone who is not an admin. This is decluttering, not an access restriction: the files underneath stay readable through the API, and the menu says as much where you turn it on. The list of hidden folders lives in the organization's existing settings, so there is no schema change to apply.

### Fixed
- **Metadata written without SOLIDWORKS open could vanish, and the "Document Manager cannot write configuration properties" limitation never existed** — creating a property through the Document Manager library asks for the property's type, and BluePLM asked for type `2`, which is not one of the types that exist (the text type is `30`). The library refused every create and said so in its return value; BluePLM discarded that value, counted the write as successful and reported it back to you. Updating a property that was already in the file worked, which is why the failure looked like a configuration-scope problem for three releases: a part whose configurations already carried the properties updated fine, and a part that needed a new one silently did not. Measured side by side on a real part, the documented type writes and reads back correctly at both file and configuration level.
- **A file's references have never been resolved through the Document Manager library** — the reference search is told what to look for as a set of flags, and BluePLM passed only the document *types* to match, never the flag that means "look for external references". The library did exactly as asked and returned nothing, on every file, always. On a test drawing the old flags found 0 references and the corrected ones found the drawing's model.
- **A refused write is now reported as a failure** — neither the result of creating a property nor the result of saving the file was checked, so a save the library refused - because the file was read-only, the common case for a vault file you have not checked out - was indistinguishable from one that succeeded. Both are now checked, the write reports the real outcome, and the SOLIDWORKS fallback gets its chance instead of being skipped after an imaginary success.
- **The SOLIDWORKS path told the same lie, and now it does not either** — the fix above covered the Document Manager library, but the fallback that drives SOLIDWORKS directly had the identical defect and is the path every configuration-level edit took. SOLIDWORKS answers each property write with a code saying whether it landed, and answers the save with a list of reasons it could not be written; all of them were discarded, so "properties set: 6" meant "6 properties were requested", never "6 properties are in the file". Each write is now checked individually and the save's reasons are read and reported in words - "the file is read-only - check it out first" rather than a silent success. A model that saved with a rebuild error still counts as written, because it was.
- **Editing a configuration's properties no longer waits for SOLIDWORKS to start** — configuration-level edits were deliberately excluded from the fast path, on the belief that the Document Manager library could not create configuration properties. It never had that limitation: creates were failing at *every* scope for the type reason above, and it only looked configuration-specific because file-level properties usually already exist while a configuration frequently needs one created. With the type corrected, configuration edits take the same path file-level edits already did and skip the SOLIDWORKS cold start.
- **Saving a part with many configurations is one pass over the file instead of one per configuration** — the "batch" write opened, saved and closed the part once for each configuration, so a part with 68 of them did that 68 times inside a 60-second budget and frequently ran out of time. It now writes every configuration inside a single open-and-save through the Document Manager library, and falls back to the old per-configuration route only if that fails. When it does fall back it reports which configurations were written and which were not, rather than declaring success because at least one of them worked.
- **"Not a native SOLIDWORKS file" for files that plainly were** — the table that turns the library's open-failure code into a sentence was shifted by one from code 2 onward. A read-only file reported "not a native SOLIDWORKS file", a missing licence reported "file is open in another application", and a genuinely missing file reported "file is read-only". Every code now says what it means.
- **"SOLIDWORKS is not available" while SOLIDWORKS was open** — with two releases installed side by side, BluePLM only ever asked Windows for the version-independent `SldWorks.Application`, which points at whichever release registered last. That is frequently not the one you have open, and a running SOLIDWORKS only publishes itself under its own versioned identifier, so every attempt to connect failed even though the application was right there. BluePLM now tries each installed release in turn and connects to the one that is actually running.
- **BluePLM no longer starts a second SOLIDWORKS behind your back** — when connecting failed it fell through to launching SOLIDWORKS, which on a multi-version machine started a *different* release that then sat there consuming a licence and never became usable. It now refuses to launch while a SOLIDWORKS is already running and reports why the connection failed instead.
- **File reading uses the Document Manager library that matches your SOLIDWORKS** — the library was loaded from a hardcoded path, so a 2024 library could end up reading files saved by 2026. It now comes from the release you selected.
- **Reading metadata no longer gives up when SOLIDWORKS stops answering** — SOLIDWORKS sometimes runs without publishing itself for other programs to connect to, and BluePLM assumed a file was open in it whenever that happened. That assumption is the safe one, but it also routed every read down the one path that could not possibly work, so properties, configurations and references all failed on files BluePLM could have read perfectly well through the Document Manager library. It now recognises that an unreachable SOLIDWORKS cannot be holding your file either, and reads it directly.
- **"Sync Metadata" on a drawing explains itself when it cannot reach SOLIDWORKS** — the connection error was flattened into a plain sentence somewhere on the way back, so the check meant to recognise it never matched and you got a generic failure with nothing to act on. The specific cause now survives the trip and you are told the connection to SOLIDWORKS is what needs fixing.
- **A drawing finds its part even when the two are not named the same** — pulling a drawing's item number and description depends on locating the model it documents, and the only fallback was to look for a part with the drawing's exact filename. `battery-4s-10ah.SLDDRW` therefore never found `battery-lp-4s-10ah.SLDPRT`. BluePLM now also consults the references it has already recorded for that drawing, and failing that will pair a drawing with the single part or assembly sitting in its folder. That last one is a guess from folder layout, so it fills in BluePLM's fields for you to check but is never written back into the drawing file.
- **"Scan Vault" no longer lets a hidden folder decide your next part number** — the scan that works out the highest serial number already in use read every file in the organization, so the part numbers on regression test fixtures counted towards the next real one and could push it forward by an arbitrary amount. Files in folders hidden from non-admins are now left out, and the scan reports how many it skipped so the exclusion is visible rather than silent.

## [3.23.0] - 2026-07-31

### Added
- **Customers module** — a new top-level module for pulling customers, addresses and orders out of Odoo and enriching them with researched background and a category. It opens as a three-zone workspace: a segment navigator on the left, charts and a virtualized roster in the middle, and a customer 360 panel on the right. The aggregation runs in database RPCs rather than in the client.
- **`POST /api/customers/sync`** — pulls partners, addresses, orders and order lines from Odoo. Gated on `module:customers` + `create`. Field selection is intersected against Odoo's own `fields_get`, so a field your Odoo doesn't have is skipped rather than erroring the run.
- **A sync you can watch and stop** — `integration_sync_log` carries phase, progress, heartbeat and cancel columns, the API drives them through a `SyncRun` reporter and honours a cancel request at phase checkpoints, and the UI polls a status endpoint. The sidebar and the main area share one sync button instead of each rendering its own live copy.
- **"Full resync"** under the sync button — re-reads everything, ignoring the watermark. Only needed to repair a mirror by hand or after changing what the sync maps.
- **`full: true`** on `POST /customers/sync`, and `since` redefined against `write_date` rather than `date_order`. The response now reports `mode` and the window it used.
- **Module access allowlist** — a `module_access` table with `user_can_access_module`, `get_denied_modules`, `get_module_access_config` and `set_module_access`, plus a settings editor for choosing which modules an organization's users can reach. The permission rows and labels for retired modules are gone.
- **Two new permission resources** — `module:customers` and `system:customer-enrichment`, the latter gating the (paid) AI enrichment runs separately from ordinary customer access.
- **Duplicate a SolidWorks part together with its drawing** — a new file context-menu action. A drawing stores the path of its model inside the file, so copying both byte-for-byte would leave the new drawing pointing at the original part; the service rewrites that stored reference after the copy, using the Document Manager API or Pack and Go.

### Changed
- **A state change is now one atomic, permission-checked operation** — the client used to write the file, its assignment and its state history separately, without checking the file was actually in the transition's starting state, without reading the transition's allowed roles, and without honouring the target state's checkout rule. It also branched on a column that does not exist, so the legacy `files.state` was never updated. All of it now happens inside `execute_workflow_transition`: the guards run, the file and its assignment move together, the revision bumps if the state says so, and `workflow_history` and `file_state_entries` record it. A stale transition list produces a clear "the file is no longer in this state" rather than a silent wrong move.
- **Approval gates finally mean something** — a gated transition opened review rows that nothing ever read, and re-running it just piled up duplicates. Gates now appear in Reviews under "Workflow gates", honour the gate's approval mode and required count, and the last approval is what moves the file. A rejection cancels the sibling reviews so the change can be resubmitted rather than sitting behind reviews nobody can action.
- **`POST /files/:id/release`, `POST /files/:id/obsolete` and the `state` field on `PATCH /files/:id/metadata` go through the workflow engine** instead of writing the state column directly, so an ERP integration cannot walk a file past its own workflow's rules. A file that has no workflow assigned still takes the direct path. A blocked change answers `202` with `requires_review`, and a refusal carries the reason.
- **Bulk "Change State" in the file list actually changes state** — it called an update that returned success without doing anything unless a workflow state id was passed, which the three callers never did.
- **Ten workflow tables that were never wired to anything are gone**, along with roughly seventy generated types for them. `workflow_history` and `file_state_entries` are kept, given the org-scoped policies they were missing, and are now written on every transition.
- **The date range now governs the whole Customers module** — the 30 days / 90 days / YTD / 12 months / 24 months / All time selector only ever reached the Overview tab. The Customers, Accounts, Distributors and Integrators tabs kept reporting lifetime totals, and so did the detail panel, so a dashboard showing one quarter sat directly above a table showing all of history. Spend and order counts everywhere in the module are now the selected period's, including the channel revenue split, the partner tabs, the CSV export and the detail panel's header, order list and top products.
- **Segments and "last order" deliberately stay lifetime**, evaluated as of the range's end. Narrowing to 30 days should not turn a customer who has bought for years into a prospect, and "when did we last hear from them" is exactly the question a narrow window would answer wrongly. Customers with nothing in the period stay listed at zero rather than disappearing, so the tab remains a directory you can search.
- **The cohort heatmap is anchored to the end of the selected range** rather than to today, and no longer counts activity past it.
- **The Odoo customer sync reads only what changed** — every run re-read every partner, every order and every order line in Odoo and rewrote the whole mirror, so a sync cost the same on day 100 as on day 1. Runs now resume from a watermark recorded by the last successful sync and pull only what Odoo has written since, anchored on Odoo's own `write_date` rather than the API server's clock. **The first run after upgrading is still a full mirror** — it is the one that records where it got to; the run after that is the fast one.
- **A sync that is cancelled or fails no longer advances the watermark**, so the window it did not finish is re-read by the next run rather than skipped.
- **The customer read against Supabase is no longer whole-table-times-every-column** — the wide read that exists to avoid blanking fields Odoo did not return is now restricted to the partners actually pulled, leaving only a narrow `id, erp_id, name` read of the table.
- **Deleted customers are still detected on every run** — a deletion writes nothing, so no change window can contain it. The sweep now asks Odoo for the live customer list as bare ids instead of whole records, which is cheap enough to run every time. It also catches a partner that is still in Odoo but has stopped being a customer, which the old full-pull diff missed. The sweep refuses to act on a list that came back empty against a non-empty mirror, or one truncated at the pager's ceiling.
- **An order whose lines changed underneath it is refreshed** — editing a line does not reliably move its order's `write_date`, so changed lines are probed separately and their orders folded in. Without this an incremental sync would mirror stale line totals indefinitely.
- **The Customers dashboard no longer pays for the same data twice** — RLS predicates are InitPlan-cacheable, `first_order_date` and per-customer order indexes are in place, segment counts come back with `customer_analytics_summary`, the detail panel loads in a single `customer_detail` round trip, and a request cache sits in front of the analytics queries.
- **An `admin` grant on a resource now implies every action on it** — the UI has always treated it that way, but the SQL matched the action exactly, so a team granted only `admin` was shown controls the database then refused with a 403.
- **`is_org_admin()` accepts `users.role = 'admin'` as well as membership of the Administrators team** — the API routes checked the role while the SQL checked only the team, so an admin outside that team could run the supplier sync but not the customer sync.
- **Odoo access is now read-only by construction** — all Odoo calls go through `odooReadOnlyCall`, which validates the model and ORM method against an allowlist and rejects writes, including ones nested inside a batch. The unguarded client is no longer exported.

### Fixed
- **Drawing a transition landed it somewhere other than where you dropped it** — every node was hit-tested as a rectangle, so an endpoint dropped on a diamond or an ellipse settled in the empty corner of its bounding box; the drop target itself was whichever DOM node happened to receive the mouseup, guarded by half-second timers; and the anchor you chose was thrown away on insert in favour of an arch waypoint, so the finished arrow visibly jumped. Connections now snap to the real silhouette of the shape — the border highlights as you approach it, ports magnetise from 16px away, and the node lights up from 28px out so you never have to land inside it. The rubber band is drawn by the same maths that draws the committed line, the drop is resolved from geometry at pointer up for both drawing and re-anchoring an existing end, and the anchor is saved with the transition. Dropping on the border pins the endpoint there; dropping on the body attaches to the node and re-routes when it moves. Hold **Alt** to place an endpoint exactly, ignoring the magnets. Ports and highlights keep their size on screen, so they are as easy to grab at 25% zoom as at 200%.
- **Transition handles sat outside the boxes they were attached to** — three different numbers described how tall a state box is: the constants file said 60, the canvas context declared its own private 50 and drew the node with it, and the line renderer anchored to 60. Every unresized node's endpoints were 5px off, resized nodes were off by however much they had been resized because the handle code never passed the size through at all, and a pair of transitions running in opposite directions had their handles on top of each other because only the line applied the 14px separation. The three renderers no longer each re-derive the geometry: the line, its drag handles and the rubber band shown while connecting all read one `computeTransitionGeometry`, so a handle is where its line is by construction. A label pinned to a fixed spot now keeps its drag handle, and a transition whose two states sit on top of each other no longer places its label at `NaN`.
- **The diagram forgot its layout on every refresh** — node sizes, waypoints, edge anchors and label positions lived only in React state. They are now real columns and survive a reload; a drag writes once when it settles rather than on every frame.
- **Redo undid things** — undoing an added state pushed a *delete* onto the redo stack, so redo deleted the state instead of bringing it back, and the same for transitions. Redoing a move re-applied the position from *before* the move. Dragging a node was not undoable at all, because nothing ever recorded it. A history entry now always describes what you did, undo reverts it and redo re-applies it, and a failed write puts the entry back rather than leaving the canvas and the database disagreeing.
- **Ctrl+C, Ctrl+V, Delete and Escape fired while you were typing** — the canvas shortcuts had no editable-target guard, so renaming a state and pressing Delete deleted the state. They now stand down for inputs, textareas, selects and contenteditable fields.
- **Importing a workflow could leave you with nothing** — the import deleted the existing graph and then inserted the new one without a transaction, so a malformed file emptied the workflow. Import now runs as a single database transaction and validates the payload first, and export carries the whole diagram — styling, node size, gates and routing — so a round trip reproduces what you were looking at. Files exported by the old version still import.
- **Switching workflows kept the previous canvas** — selection, in-flight drags and layout maps all carried over, and a slow load could overwrite a newer selection.
- **Saving a drawing stalled for ten seconds and then reported nothing to sync** — before reading a file's properties or references, the service asks whether SolidWorks has that file open, because the fast Document Manager API must not touch a document SolidWorks is holding. That question was answered by a fresh Running Object Table lookup, which fails permanently with `MK_E_UNAVAILABLE` when SolidWorks and BluePLM run at different integrity levels, and a failed lookup is deliberately read as "assume open". So every read took the full SolidWorks path at roughly 2.5 seconds instead of milliseconds — even with no documents open at all, which is exactly what the service's own "list open documents" command reported in 12ms using the connection it already had. The check now answers from that same cached connection first, and only falls back to a lookup when it has none. Two separate subsystems were also each asking the same drawing for its references after a save, queueing a second three-second round trip behind the first; they now share one.
- **A metadata refresh that found everything already up to date looked identical to one that failed** — it logged only when it changed something, so the common case left no trace at all. Each file's outcome is now recorded, and the summary distinguishes files that were updated, files already in sync, files that could not be read, and files never attempted.
- **Your biggest customers were showing as churned** — Odoo puts the ordering *contact* in `sale.order.partner_id`, and for a company customer that is one of its employees, so every order was credited to whichever person was named on it. A company's own row kept the date of the last order booked directly against it, aged past the 365-day threshold and read as "Churned" while its contacts showed orders from that morning. Orders are now credited to the company — the contact's `commercial_partner_id`, exactly as Odoo's own sales reporting groups them — and the contact who placed each one is kept in the new `customer_orders.contact_id`. Because standard Odoo defines that field on `res.partner` and not on `sale.order`, the sync builds the contact-to-company map from partner records, reading whichever contacts and parent companies the customer pull did not already return. A **full resync** after upgrading is what re-points the orders already mirrored.
- **A company and its contacts no longer appear as separate customers** — the Customers table listed one row per Odoo partner, so "SIX Voice" and "Shuhei Habu" sat side by side splitting the same account's money between them. It now shows one row per company, expandable to reveal the contacts underneath, with spend, orders and recency rolled up. Filters match an account when the company or any of its contacts matches.
- **The Accounts tab showed a stale segment** — it took the segment from the first contact it happened to read while computing recency across all of them, so an account could read "Churned" next to a last order from today. Both the tab and the customer table now derive the segment from the rolled-up dates.
- **An account could be named after a contact** — accounts recorded the name of whichever partner reached them first, so "BlueLink" could display as "Blake Bennett". A company name now wins over an individual's.
- **"Generate PDF" killed the SolidWorks it had just started** — exporting with SolidWorks closed launches a hidden instance, and a hidden instance carries the same OpenGL dummy window title that the background cleanup treats as the definitive sign of a zombie process. The cleanup runs every five seconds, so it usually killed the instance part-way through startup and the export died with "The RPC server is unavailable". The service now reports the process it launched, and the cleanup leaves that one alone.
- **An export that had already succeeded could still be reported as failed** — the app sent up to three commands at once to a service that runs them strictly one at a time, so a short command such as reading a drawing's configurations hit its 10-second timeout while still queued behind a 20-second export. When its answer finally arrived nobody was waiting for it, and the app handed it to the oldest request still outstanding: the export, which then reported an unrelated command's error while its finished PDF sat on disk. The export's own success was in turn delivered to whatever came next. Responses now go to the request that asked for them or are discarded, and commands are sent one at a time so a short operation is never timed against work that has not started.
- **Drag-and-drop moves were reverted, or blocked outright** — a vault load scans the disk and fetches the server list in parallel and then replaces the store with the merged result, so a file operation that landed in between left the two halves describing different states of the vault: the merge undid the move on screen and could drop the affected files from both the source and the destination folder. A pass now notices the ground moved under it and reruns instead of committing. On Windows the copy itself could also fail, because `CopyFileW` rejects a read-only destination and carries the read-only attribute onto the copy, so a move could re-lock a checked-out file, and dropping an item onto the folder it already lives in resolved to a copy onto itself. Copies clear the flag explicitly and a self-copy is treated as the no-op it is. A path update also records who made it, so realtime no longer notifies you about your own move.
- **A customer sync against an older API server sat on "Starting..." forever** — a build that predates the cancellable sync has no status or cancel route, but it does have the start route, so the sync began and then became invisible: every status poll returned 404 and was discarded without a word. Repeated failed reads now give up with an inline message naming a stale deploy, Stop tells "this build has no cancel route, redeploy" apart from "there was nothing running", and the version check that was defined but never called runs at startup, so drift is reported once instead of being discovered through a feature quietly doing nothing. `/health` also reports the commit it was built from, which read only the Railway and Render variables and so was always null when deploying from the registry.
- **ERP API keys were stored in plaintext and readable by every member of the org** — `odoo_saved_configs.api_key_encrypted` and `organization_integrations.credentials_encrypted` were named as though they held ciphertext but were written raw, and the SELECT policies on both tables grant access to all org members. RLS filters rows rather than columns, so no policy change could hide them. Credentials now live in `integration_credentials`, which has RLS enabled and no policies for `anon` or `authenticated`, making it reachable only by the API's service role. Values are AES-256-GCM encrypted under a new `EXTENSION_ENCRYPTION_KEY` environment variable, existing keys are migrated across and re-encrypt themselves on next write, and the API no longer returns a credential to the client at all — the UI gets a `has_api_key` flag instead.
- **XML entities in Odoo responses were not decoded** — a company name containing `&amp;` came back mangled.

### Schema
- Bumped to schema version **86** (`EXPECTED_SCHEMA_VERSION`). Apply the latest `supabase/core.sql` together with `modules/10-source-files.sql`, `modules/40-integrations.sql` and `modules/60-customers.sql`.
- Run a **full resync** of customers once afterwards — it is what re-points the orders already mirrored from the contact who placed them to the company behind them.
- This release expects **API 2.4.0** and **SolidWorks service 1.12.0**: redeploy the API and rebuild the service from `solidworks-service/`.

---

## [3.22.0] - 2026-07-28

### Added
- **Copy Item Number / Description via highlight box** — a slow double-click on a non-editable Item Number or Description cell now opens a read-only, auto-selected highlight box (mirroring the Name column) so the value can be copied cleanly. Editing stays gated on checkout, and a fast double-click still opens the file.
- **Pending panel scrolls the file into view** — clicking a file in the Pending panel (Open Files, checked out, new files) selected it but didn't scroll it into view. It now reuses the existing `pendingScrollToFile` mechanism so the file list scrolls to the selected file.
- **SolidWorks service status indicator in the top bar** — a CAD glyph next to the org/online-users cluster shows the live service state: a spinner while connecting, a green check when running (with Document Manager), yellow for DM-only, red when stopped, gray when unconfigured. Hover shows service stats (running, SolidWorks installed, DM availability, version, queue depth) and clicking opens Settings → SolidWorks. Toggle it via the top-bar config dropdown ("SolidWorks Status").
- **Keep SolidWorks warm in the background (organization-wide)** — an admin setting that pre-launches a hidden SolidWorks instance so the first property edit is instant instead of paying a ~40s cold-start. No window is shown. Default on, switchable off per organization.

### Changed
- **SolidWorks service now starts from the Electron main process at app launch** — the service is launched in parallel with the renderer's initial vault load using a cached auto-start policy, so it's ready in ~2s instead of waiting behind the boot work. The renderer's auto-start becomes an idempotent confirmation. (Takes effect from the second launch after upgrading, once the policy cache is written.)
- **Interactive SolidWorks commands now jump the queue** — opening a folder floods the concurrency-3 command queue with one preview request per file, which pushed the properties for the file you just clicked (or a status ping) tens of slots back until it timed out. Commands are now tagged interactive (status probes, get/set properties, configurations, references, selection) or bulk, and the queue serves the highest priority first, FIFO within a priority.
- **Navigating away from a folder cancels its queued previews** — leaving a folder now drops any still-queued preview requests for files no longer on screen. Up to three already dispatched to the service can't be aborted and still run to completion.
- **Icon grid view is row-virtualized** — every card in a folder used to mount at once, and each card starts a thumbnail extraction, so a folder with thousands of files mounted thousands of cards and queued thousands of extractions. Only visible rows (plus three rows of overscan) now render, and selection lookups moved from per-card array scans to set lookups.
- **Vault watching on Windows and macOS switched from chokidar to a single native recursive watch handle** — see the startup fix below. Linux keeps chokidar, since Node's recursive watching there is a userspace tree walk with nothing to gain.
- **SolidWorks service bumped to 1.10.0** — see the COM stability fixes below.

### Fixed
- **Startup took 35–40s on a large vault because the file watcher starved the main process** — chokidar walks the whole tree before it reports ready, and on a 27,600-entry vault that measured 194,928ms while saturating the main process event loop the entire time, so the startup vault scan crawled behind it. Windows and macOS now use one native recursive `fs.watch` handle, which the OS sets up in constant time (measured at 0ms on the same vault). The scan itself was also made non-starvable: it yields on a time budget and stops yielding if wall-clock time diverges from time actually spent working. The same vault scan now completes in about 1.6s. The native backend reimplements what chokidar provided — add/change/unlink/addDir/unlinkDir classification and `awaitWriteFinish` — and asks the renderer for a full resync if the watch handle is ever lost. Windows also emits notifications with no filename attached (roughly one every two seconds on an idle vault of this size); those are counted and ignored rather than treated as lost events.
- **Files showed as modified forever with nothing to check in** — reading metadata back out of a SolidWorks file recorded every value as a pending edit, including values the database already held, and any non-empty pending metadata forces a file to render as modified. A drawing whose properties already matched the server would go orange, come back orange after check-in, and stay that way. Pending edits are now reconciled against the committed values at every point they're created or restored, so a no-op read records nothing and existing phantom entries clear themselves on the next load.
  - This required `get_vault_files_fast` and `get_vault_files_delta` to return `custom_properties` (**schema v73**), since per-configuration item numbers and descriptions live there and the file explorer never loaded the column. As a side effect the `Custom` column, custom-property search matching, grid card metadata, and config-tab exports now show data in the explorer instead of being silently empty.
- **SolidWorks COM busy states were never retried** — `CoRegisterMessageFilter` is rejected on MTA threads and the service's main thread is MTA, so the message filter registration had been failing silently and every busy state surfaced as a rejected call. The service now runs a dedicated STA thread with a real Windows message pump to host the filter, and reuses it for running-object-table lookups instead of spawning a thread per call. If a work item exceeds its timeout the pump retires itself permanently and callers fall back, so one stuck COM call can't wedge everything behind it.
- **Browsing a folder stalled on repeated failing COM probes** — the "is this file open in SolidWorks?" check ran a full probe per file, and a failing lookup costs up to ~5s when it falls back to an STA thread. Short-lived caches collapse the repeats. The process-running check caches positive results only, because a stale "not running" would route Document Manager against a file SolidWorks has open.
- **Preview extraction read entire files just to fail on them** — SolidWorks 2015+ files aren't OLE compound documents, so the reader threw a header-signature error, but only after pulling the whole file (often hundreds of MB) into memory. The 8-byte OLE magic is now checked first, which also limits how much a cloud-storage placeholder file gets hydrated.
- **Our own file writes triggered full vault reloads** — the watcher-suppression window was stamped when a write started, and a SolidWorks write takes seconds, so the window was already spent by the time the event arrived and every metadata edit was reclassified as an external change. Suppression now re-stamps on completion and carries a backstop so a missed release can't suppress a path for the rest of the session. Because the reload is suppressed, files we write ourselves now get their hash, size and mtime refreshed directly — previously the store kept the pre-write hash, which made check-in take its fast path on stale data and **skip the version increment**.
- **Overlapping vault loads did the work twice and could commit stale results** — `loadFiles` runs from several components and silent watcher-driven refreshes never set a loading flag, so two passes could each do a full local scan and server merge, with last-writer-wins deciding the outcome. Loads are now serialized, with compatible requests joining the pass already in flight.
- **Silent refreshes recomputed the whole vault even when nothing changed** — a refresh now fingerprints the scan (path, size, mtime) in tens of milliseconds on a 27k-item vault and skips the multi-second merge entirely when the server delta was empty and nothing on disk moved. Explicit refreshes and first loads always take the full path. Watcher-driven refreshes also re-stat only the paths that changed instead of walking the tree again.
- **Store writes that changed nothing invalidated every memo** — any write replacing the files array forced the tree, folder metrics and sorting to recompute across tens of thousands of files. Updates that match the existing values now leave both the array and the individual entries referentially unchanged. Separately, the vault tree hook runs in three components at once and each recomputed the same tree independently; they now share one result.
- **Packaged builds shipped without the extension host** — the copy step ran only before `dev`, so `host.html` and its preload were missing from production builds. The build script now runs it between the Vite build and packaging, where it can't be wiped by output cleaning.
- **Backup errors buried the log** — repository access failures don't self-heal but the snapshot list is polled every few minutes, so each poll logged another copy of the same error. It's now logged once per repository until the message changes or the repository recovers, and a defensive stop no longer logs a phantom stop/start cycle on every service start. The backup service also stopped restarting itself whenever unrelated vault or selection state changed.
- **Marquee selection in icon view selected whole rows** — the selection box tested vertical overlap only, which is correct for full-width list rows but caught every card in a row when dragging across one card in the grid. Grid view now tests both axes. Clicking a file elsewhere in the app also scrolls it into view in grid mode, matching list mode.
- **Schema version rolled backwards when installing optional modules** — `update_schema_version()` did a plain `SET`, and because optional modules run after `core.sql` (which stamps the current head), a module stamping its own lower version dragged the recorded `schema_version` below what the app expects, producing a false "database is older than app" warning right after applying the schema. The setter is now monotonic (`GREATEST`), so a lower stamp is a no-op, and the inspection module stamps its own truthful version. A full `core.sql` + modules run now correctly ends at the expected schema version.
- **SolidWorks service booted ~22s late and status was stuck on "not running"** — on large vaults the renderer thread was saturated by the initial vault load (tens of thousands of IndexedDB sync/inode/version reads plus a synchronous file merge), which starved the renderer-driven service auto-start; meanwhile status polling was suppressed for the whole window, so the UI showed a stale "not running." The service now starts from the main process at app-ready (see Changed), and auto-start surfaces a "connecting" state instead of freezing on the last value.
- **Top-bar toggles reset to defaults for pre-existing configs** — the store's rehydrate merge replaced the entire persisted `topbarConfig`, so newly added toggles (e.g. the SolidWorks Status indicator) resolved to `undefined` and were hidden. The merge now layers the saved config over the defaults so new toggles backfill correctly.
- **File explorer column order not persisted across restarts** — column widths and visibility already persisted, but the store's rehydrate merge rebuilt columns in the default order and dropped the user's saved ordering. Columns are now rebuilt in the persisted order, with any new built-in columns appended at the end.
- **Column resize triggered a sort** — releasing the resize handle fired a click on the header that sorted the column. The resize interaction is now flagged so the trailing sort click is skipped (header click still sorts, drag-to-reorder still works).
- **PDF comments — can't type spaces in a reply or edit** — the comment thread wrapper is a `role="button"` element that calls `preventDefault()` on Space/Enter so it can be keyboard-activated, but the reply and edit textareas are nested inside it. Every keystroke bubbled up to the wrapper, so Space was swallowed (no space character inserted) and Enter doubled as a thread click. The wrapper's `onKeyDown` now ignores events that originate from nested inputs (`e.target !== e.currentTarget`).
- **PDF comments — editing or deleting a reply did nothing in the UI** — the annotations store holds a threaded tree, but `updateAnnotationInStore` and `removeAnnotation` only scanned top-level threads, so optimistic edits/deletes of nested replies (and realtime reply deletions from other users) silently missed and the stale reply stayed on screen until a full reload. Both now recurse into nested `replies`.
- **PDF comments — a failed reply discarded the typed text** — `handleReply` swallowed save errors, so the input closed and cleared even when the reply failed to persist. It now surfaces the error and keeps the input open with the text intact for retry.
- **Review kickback — "invalid input value for enum review_status: kicked_back"** — the `kicked_back` value was added to the `review_status` enum (schema v55) by editing the `CREATE TYPE` statement, which only runs for brand-new databases; pre-existing databases never received the value, so kicking a review back failed. Added an idempotent `ALTER TYPE review_status ADD VALUE IF NOT EXISTS 'kicked_back'` backfill that repairs existing databases.

### Schema
- Bumped to schema version **73** (`EXPECTED_SCHEMA_VERSION`). Admins must apply the latest `supabase/core.sql` (plus any optional modules in use) for the phantom-modified-file fix and the review kickback repair to take effect.

---

## [3.21.0] - 2026-06-16

### Changed
- **SolidWorks write performance & reliability** — file-level metadata edits no longer trigger a SolidWorks cold start: the service now writes file-level-only properties via the Document Manager API first and only falls back to the full SolidWorks COM API when needed (service bumped to **1.2.4**). Description-only edits skip redundant config writes, and service health pings are calmer (less polling churn).

### Fixed
- **Clearing a description (or item number) now sticks through check-in** — emptying a part/assembly description or item number wrote correctly but then bounced back to the old value on the next read, and emptying-then-checking-in reverted the field entirely. Decisive write handling now persists cleared/blank values instead of treating them as "no change," and the check-in path sends an explicit empty string instead of collapsing an intentional clear (`null`) into `undefined` (which the `checkin_file` RPC's `COALESCE` treated as "no change"). Cleared fields stay empty.
- **Removing a local copy now clears cached metadata** — "Remove Local Copy" deleted the file from disk but left locally persisted pending metadata (per-config descriptions, part number/description/revision edits) in `localStorage`. Re-downloading from the server could resurrect those stale values, causing different users to see different per-config descriptions for the same part. Deleting a local copy now wipes the persisted metadata for those files so a fresh download pulls clean metadata from the server.
- **Cold-start version/hash detection no longer reports false changes** — on a cold start (when only the IndexedDB sync index is available), local version and hash lookups missed entries because the seed maps were keyed only by the original-case path while the IndexedDB index uses a lowercase key space. Persisted `localVersion`/`localHash` values are now mirrored under a lowercase key and looked up with a lowercase fallback, so cold-start and warm-refresh loads share a key space and stop surfacing spurious "modified" files.

---

## [3.20.0] - 2026-06-11

### Changed
- **Vault access is now opt-in** — previously a user with no vault grants implicitly saw *all* organization vaults (opt-out). Now non-admin users only see vaults they have been explicitly granted access to, via individual `vault_access` or one of their teams' `team_vault_access`; with no grants they see no vaults. Admins continue to see all vaults. `getAccessibleVaults` no longer falls back to "all vaults" on an empty grant set, and `checkVaultAccess` now resolves effective access (individual + team) and denies by default instead of treating a vault with no access rows as unrestricted.
  - **Breaking for existing orgs**: this is a hard cutover. After upgrading the schema, any non-admin user whose effective vault set is empty (in no team, or only in teams without `team_vault_access` such as the default "New Users" team) loses access until an admin grants it. Users already covered by team or individual grants are unaffected.

### Fixed
- **Invite vault selections are now applied** — `pending_org_members.vault_ids` chosen when inviting a member were stored and shown in the admin UI but never written to `vault_access` on signup. `apply_pending_team_memberships` now grants those vaults when the invite is claimed, so invite-time vault scoping actually takes effect under the opt-in model.

### Schema
- Bumped to schema version **62** (`EXPECTED_SCHEMA_VERSION`). Admins must apply the latest `supabase/core.sql` for the invite-grant behavior to take effect.

---

## [3.19.2] - 2026-06-11

### Fixed
- **Ghost file after server delete (unrecoverable cache entry)** — deleting a file from the server left a stale entry in the IndexedDB vault cache that no recovery action could clear: check-in failed with `File not found` and discard failed with `Cannot coerce the result to a single JSON object`, because both referenced a file id whose server row was already soft-deleted (and thus invisible to normal queries). Three fixes:
  - `delete-server` now invalidates the vault cache (`clearVaultCache`) after a successful server delete, just like discard does, so the next load rebuilds cleanly instead of resurrecting the deleted file as a ghost.
  - `undoCheckout` (used by Discard) now uses `.maybeSingle()` and treats a missing/already-deleted row as success, instead of throwing PostgREST `PGRST116`. This makes Discard a reliable "clear ghost" escape hatch for any pre-existing stuck entries.
  - `softDeleteFile` now bumps `updated_at` alongside `deleted_at` so the watermark-based delta sync (`get_vault_files_delta`) reliably surfaces the deletion to other clients.

---

## [3.19.1] - 2026-05-28

### Fixed
- **Ghost server-only files after move/delete** — moving a file into a subfolder (e.g. `CELSIUS-2/foo.SLDPRT` → `CELSIUS-2/Archive/foo.SLDPRT`) succeeded on disk but the next Refresh resurrected the original location as a synthetic cloud-only entry; an app restart was needed to clear it. Same family of bug caused `delete-server` files to reappear on Refresh. Root cause: the store kept two parallel views of server state (`state.files` with per-file `pdmData`, and a flat `state.serverFiles` array used by `refreshCurrentFolder` to detect cloud-only paths) and only `state.files` was updated on local mutations or realtime echoes — the stale `serverFiles` list still referenced the old path, so step 6 of the refresh pushed a synthetic `diffStatus: 'cloud'` row. Every mutator that touches `state.files` now mirrors the same shape change onto `state.serverFiles`: `renameFileInStore` (file + directory-prefix cases), `batchUpdateFileLocationsFromServer` (realtime move echoes), `updateFileLocationFromServer` (single-file realtime echoes), `removeCloudFile` (drop by id), `removeFilesFromStore` (drop by relative path with directory-prefix support), and `addCloudFile` (idempotent insert by id).
- **`localHash` / `localVersion` drift causing files to falsely appear "synced"** — Wilson's intermittent symptom (BluePLM showed v2 while disk actually held v1, only fixable by deleting local and repulling) traced to several places where the trust chain for `localHash` and `localVersion` could drift from disk reality:
  - `useLoadFiles`: `existingLocalHashes` was seeded by full path but looked up by either full or relative path; IndexedDB hashes from prior sessions never reached the merge. Now seeded and looked up by both.
  - `useLoadFiles`: when a file appeared synced via path/extension match but had no on-disk hash evidence, the merge stamped `localVersion = pdmData.version` optimistically, so a file that was never opened locally was reported as the cloud version. Removed the optimistic fallback — `localVersion` now only advances when we actually have disk evidence.
  - `useLoadFiles`: "first-sight" files (a path that already has `pdmData.content_hash` but no `localHash`/`localVersion`) skipped hash computation when `skipHashComputation` was true, so the file's status was determined by missing data. They now force a single hash on first sight even in the skip path.
  - `pushPartAssemblyMetadata` and `saveMetadataToSWFile`: SolidWorks property writes (which mutate the file on disk) didn't suppress the FileWatcher and didn't refresh `localHash`. Both paths now wrap the write with `addExpectedFileChanges` / scheduled `clearExpectedFileChanges`, then re-hash the file and write the new `localHash` (with `localVersion: undefined` so the next loadFiles can recompute) into the store.
- **`expectedFileChanges` set growing unboundedly across move/copy/rename/newFolder/merge** — every command that called `addExpectedFileChanges` lacked the matching scheduled clear that `download.ts` and `getLatest.ts` already use. All five sites in `fileOps.ts` now schedule a `clearExpectedFileChanges` 5 s after the operation registers its expected paths.

---

## [3.19.0] - 2026-05-14

### Changed
- **Top search bar defaults to current folder** — placeholder now reads `Search in <FolderName>...` (dim) and results are restricted to files under the current folder. A new "Scope" section at the top of the filter dropdown lets you switch between **Current folder** and **All folders** without leaving the dropdown that already lives on the top bar.

### Removed
- **System stats topbar widget** — the CPU/Memory/Disk/Network widget in the title bar polled `system:get-stats` every 2 s, and on Windows the `systeminformation` package spawned a fresh `powershell.exe` per WMI/CIM query (multiple per poll). On slower machines those spawns stacked up faster than they could exit, producing 8–10 `powershell.exe` children at ~10% CPU each and starving the main process (which also caused the SolidWorks watchdog `tasklist`/`cmd.exe` `ETIMEDOUT` errors). Removed the widget, the `system:get-stats` IPC handler, the `getSystemStats` preload bridge, and the `systeminformation` dependency. Dev-tools telemetry now reports FPS only (CPU/memory/network graphs and `QuickStatCard`s removed alongside).
- **⌘K hint in the search input** — the inline keyboard-shortcut badge has been removed (the Ctrl/⌘+K global shortcut still focuses the search bar).
- **Duplicate filter row in the search dropdown** — the `QuickFilters` row that mirrored the filter button on the top bar has been removed; filters are now configured in one place (the filter button's dropdown).

---

## [3.18.0] - 2026-04-21

### Security
- **App & IPC** — Vault-scoped `fs:read-file` / `fs:write-file`; extension secrets require `EXTENSION_ENCRYPTION_KEY` (no default key); drag-preview file names use `createTextNode` (DOM XSS); dependency audit fixes (Fastify, systeminformation, rollup, etc.)
- **API** — `@fastify/helmet` security headers; production CORS deny-by-default (`CORS_ORIGINS` allowlist); stricter `/auth/login` and `/auth/refresh` rate limits; `/health` errors sanitized; Swagger UI disabled in production; search on `/files` and `/suppliers` protected from PostgREST filter injection; webhooks reject private/internal URLs (SSRF)
- **Database** — RLS tightened so `organizations` / `users` are not enumerable across orgs
- **CLI** — Local HTTP server CORS limited to localhost

### Removed
- **WooCommerce integration** — removed unshipped WooCommerce connector (tables, API routes, settings UI); may return as an extension

### Fixed
- **Refresh button crash** — `refreshCurrentFolder` used `sf.name` (undefined) instead of `sf.file_name` when building cloud-only file entries from `LightweightFile` objects, corrupting ~11K files in the store and crashing React rendering with `TypeError: Cannot read properties of undefined (reading 'startsWith')`; also added defensive null guards to all `.startsWith()` filter callbacks in the file tree
- **Refresh race condition** — `setIsLoading(false)` ran in `finally` before `startTransition` completed, dropping the concurrency guard too early and allowing realtime location flushes to collide with the in-flight `setFiles`; loading state now stays true until `startTransition` applies, and `flushLocationUpdates` defers while a refresh is in progress
- **Backup** — Running state survives leaving the Backup tab; stuck `backup_running_since` auto-clears after 2 hours
- **Metadata export** — Large vaults: file-version fetch batched to avoid PostgREST URL limits
- **Upload size warning** — "Upload All" button in the Large Files Detected dialog now works; previously it re-triggered the size check and silently blocked the upload

---

## [3.17.0] - 2026-03-23

### Added
- **Folder picker for stale-path restores** — restore trashed files after a parent folder rename by choosing the target folder (single or batch)

### Fixed
- **Folder rename / move** — Nested paths stay in sync (no ghost files or data loss); safe path-prefix matching; trashed files skipped; errors surfaced instead of failing silently; unsaved metadata no longer cleared incorrectly on nested updates

---

## [3.16.0] - 2026-03-19

### Changed
- **Unsaved SW files block check-in with a toast instead of auto-saving** — check-in and sync previously tried to save dirty SolidWorks files through the .NET service, which failed when SolidWorks was unresponsive. Now shows an error toast ("Unsaved changes detected — save in SolidWorks first") and aborts, letting you save manually and retry

### Fixed
- **Cannot check in files open in SolidWorks** — two separate lock checks blocked check-in of saved files: (1) the pre-check treated any file with a SolidWorks `~$` temp file as locked, and (2) the file-read safety check used `O_RDWR` which gets `EBUSY` on Windows when SolidWorks holds a shared-read lock. Both now use read-only checks (`O_RDONLY`) so check-in and sync only block when the file is truly mid-write, allowing check-in while files remain open in SolidWorks or referenced assemblies

---

## [3.15.0] - 2026-03-19

### Added
- **Review kick-back status** — reviewers can now "kick back" a file for rework, distinct from outright rejection. Kicked-back reviews show a dedicated status and badge in the Reviews dashboard
- **Breadcrumb folder dropdowns** — Explorer-style dropdown menus on breadcrumb segments let you navigate to sibling folders without backtracking
- **Card view field persistence** — toolbar field customization in card view is now remembered across sessions
- **Column layout push to all users** — admins can now force-push their current column configuration (visibility, width, order) to every user in the organization. Available from Settings > Metadata Columns and from the column header right-click menu. Connected users receive the update in real time; offline users pick it up on next launch

### Changed
- **Auto-discard orphaned files enabled by default** — local files that no longer exist on the server are now automatically cleaned up. Also fixed the setting not being persisted (it reset to OFF on every restart even if manually enabled)
- **Cancel review cancels pending responses** — cancelling a review now properly cancels all outstanding reviewer responses
- **Splash screen removed** — the multi-stage startup splash screen ("Extensions ready", progress bars) is gone. The app now shows a blank window briefly while initializing and transitions directly to the main UI. Extension load failures are surfaced as warning toasts instead of a blocking banner

### Fixed
- **Company logo missing in "Users Online" button** — the online-users button now loads the company logo independently with its own signed-URL generation, error handling, and retry, so it always shows the org logo even if the parent toolbar's async load failed. Broken URLs also fall back gracefully instead of rendering an invisible empty box
- **SolidWorks checkout not propagating read-write state after restart** — normalized path separators, added STA fallback for COM reconnection (service v1.2.1), and retry on service status check during checkout
- **Title bar drag region blocking clicks** — right-side toolbar items (stats, zoom, online users, panel toggles, user menu) were inside a single drag region, making them unclickable on some window managers. Each interactive element is now individually excluded from the drag region
- **Login screen flash on slow connections** — on slow networks the sign-in screen would briefly appear before the stored session was restored, then disappear once auto-connect completed. Startup now waits for Supabase's auth resolution (up to 15 s) before deciding what to show, eliminating the flash
- **Drawing modified after check-in (post-check-in drift)** — when checking in a drawing and its referenced part together, SolidWorks could rebuild the drawing after its content was uploaded, leaving local changes the server does not have. Fixed by: (1) setting files read-only before releasing the checkout lock instead of after, (2) processing parts/assemblies before drawings in batch check-ins to avoid reference-rebuild races, (3) re-hashing files after check-in to detect drift and warn the user, and (4) showing an "Unsaved Changes" warning in the status column for checked-in files with local modifications
- **Cannot remove rejected reviews** — the cancel/remove button was only visible for pending reviews. The requester can now remove their review regardless of its current status (rejected, approved, kicked back, etc.)
- **Sidebar module parents not persisting across restart** — moving modules out of a group (e.g. Source Files) and then restarting the app would snap them back into the group. The modules editor was deleting the parent key instead of setting it to null, so the hydration merge filled in the default group parent. Also hardened the hydration guard and made org/team default loading merge with app defaults so new modules are never missing
- **Sidebar header showing "GROUP-SOURCE-FILES" instead of "EXPLORER"** — a previous code path could set the active view to a custom group ID (e.g. `group-source-files`) instead of a module ID. This value was persisted to localStorage and restored on every launch. Added three-layer defense: hydration validation rejects group IDs and resolves to the first child module, `setActiveView` guards against group IDs at runtime, and `getModuleTitle` falls back to the group's display name or "EXPLORER" instead of exposing raw internal identifiers

### Improved
- **Scrollbar visibility** — increased horizontal scrollbar height and thumb opacity for easier grabbing
- **Explorer tree density slider** — the explorer sidebar now has its own density slider (next to the "EXPLORER" header) that controls tree row spacing independently from the file browser's density slider
- **Column order preserved on sync** — loading column defaults from the org or personal configuration now restores column order, not just visibility and width

---

## [3.14.0] - 2026-03-16

### Added
- **Copy-paste preserves version history** — pasted files inherit full history instead of resetting to v1

### Removed
- **Notifications system** — removed unused module; bell icon now shows pending review count

### Changed
- **PDF viewer rewritten** (preliminary) — new canvas-based renderer with working zoom, text selection, HiDPI support, and page virtualization

### Improved
- **Sync performance logging** — each step logs duration with a summary line for diagnostics

### Fixed
- **Drawing sync fallback** — infers parent model from filename when DM API returns no references
- **Text selection in BR cells** — cells with text content are now selectable instead of starting a drag
- **Inline edit not writing to SW file** — fixed silent exit paths and stale closure
- **Properties not written on STEP-imported parts** — falls back to SW COM API when DM API fails
- **Config properties not written** — bypasses DM API; uses SW COM API for reliable config-level writes
- **PDF area selection required extra toggle** — now enabled by default when commenting
- **Review rows required double-click** — single-click now opens preview
- **Comment sidebar ignored panel toggle** — now respects visibility state
- **PDF viewer refused locked files** — falls through to read-only open
- **SW tree rename not detected** — renamed files now correctly show as "moved" instead of "added"
- **Features broke after rename/move/copy** — fixed file extension losing its leading dot in the store
- **False "locked by Unknown" on pasted files** — read-only files no longer misidentified as process-locked
- **Silent corruption on flaky downloads** — downloads now verify hash, use atomic writes, and timeout on stalls
- **Silent corruption on flaky uploads** — check-in now verifies hash consistency, retries with backoff, and confirms upload size
- **Ghost files persisted across restarts** — `undoCheckout` now bumps `updated_at` so delta sync picks up the change; discard handler also invalidates the vault cache
- **"Match to Local File" for ghost files** — right-click a ghost file to match it to its renamed local counterpart, updating the server path via `moveFileOnServer`
- **False "outdated" on folder refresh** — refreshing a folder used timestamp-only fallback that marked files purple even when local and server versions matched; now uses version comparison first

---

## [3.13.5] - 2026-02-09

### Added
- **Copy file name from context menu**: Right-click any file and choose "Copy Name" to copy just the filename to clipboard. Works for all file states including cloud-only files, and supports multi-select
- **Slow double-click highlights name for copying**: On checked-in files that can't be renamed, a slow double-click now shows the filename as selectable text so you can highlight and Ctrl+C to copy. Useful for toolbox parts with long names where the new part is very similar

---

## [3.13.4] - 2026-02-09

### Fixed
- **File tree crash on malformed file entries**: Fixed crash in the vault tree where `folderMetrics` computation would throw `Cannot read properties of undefined (reading 'startsWith')` if a file entry had an undefined `name` or `relativePath`. Added the same null guard that already existed in the tree builder

---

## [3.13.3] - 2026-02-09

### Fixed
- **Refresh button no longer crashes on large vaults**: The file browser refresh button at vault root was falling back to `loadFiles()` — a heavy full-vault reload that blocks the main process and can freeze or crash the app on large vaults (25k+ files). The button now always uses the lightweight folder-scoped refresh, which works correctly at root too
- **Refresh button no longer crashes React**: The refresh handler used `flushSync` to force a synchronous render, which throws if called during an existing React render cycle (e.g., rapid clicks or concurrent transitions). Replaced with a safe async yield to the UI thread
- **Rapid refresh clicks no longer corrupt file list**: Added a concurrency guard so overlapping refresh operations are skipped instead of running in parallel and corrupting state

---

## [3.13.2] - 2026-02-05

### Improved
- **Config property writes now set full PDM metadata**: Editing tab number or description on a configuration now writes all related properties in a single operation - Number (combined part number), Base Item Number, Tab Number, Description, Date, and DrawnBy. This ensures files are complete when used outside BluePLM

### Fixed
- **Auto-refresh no longer overwrites part number and description**: For parts and assemblies, auto-refresh now only updates the revision from the file. BluePLM is the source of truth for part number, tab number, and description - reading these from the file would overwrite database values with potentially stale legacy properties
- **SolidWorks no longer auto-launches for drawing sync**: Reading drawing references from the parent model now requires SolidWorks to already be running. The service no longer attempts to auto-start SolidWorks, which could create zombie processes and long hangs. Users see a clear message if SW needs to be opened

---

## [3.13.1] - 2026-02-05

### Fixed
- **Drawing sync not reading from parent model**: Fixed bug where "Sync Metadata" on a drawing would not update the item number from the parent part if the drawing had its own hardcoded properties. The sync now always traverses to the referenced part/assembly and reads the current values, using the drawing's own properties only as a fallback if the parent lookup fails

---

## [3.13.0] - 2026-02-04

### Added
- **Immediate config property writes**: Editing description or tab number on a configuration row now writes directly to the SolidWorks file on blur/Enter. This ensures "Sync Metadata" on drawings always reads fresh data from the parent model, even if BR numbers haven't been generated yet

### Fixed
- **Drawing PDF export using wrong revision**: Fixed issue where exporting a drawing to PDF would incorrectly use the PDM revision (inherited from the parent part) instead of the drawing's own revision property. Drawing exports now only use the revision stored in the drawing file itself - if the drawing has no revision, it stays empty rather than inheriting an unrelated value
- **PDF filename collisions overwriting files**: Fixed issue where exporting multiple drawings with identical part numbers would overwrite each other. The export now detects filename collisions and automatically appends `(1)`, `(2)`, etc. to ensure unique filenames
- **Whitespace-only revision treated as valid**: Fixed edge case where a revision property containing only whitespace (e.g., `" "`) would pass validation checks but produce empty filenames. Whitespace-only values are now correctly treated as empty

### Improved
- **Export filename collision detection**: STEP and STL exports now also detect filename collisions when multiple configurations would generate the same filename. When a collision is detected, the configuration name is appended (e.g., `BR-100_RevA_(Tall).step`)

---

## [3.12.2] - 2026-01-28

### Fixed
- **DM-API write operations failing**: Fixed bug where `setProperties` and `setPropertiesBatch` would always fall back to the slow SolidWorks API. The Document Manager API's `OpenDocumentForWrite` was passing raw integers instead of proper `SwDmDocumentType` enums, causing COM interop failures. Write operations now use the same enum conversion pattern that works for reads
- **Improved DM-API error logging**: Added detailed logging throughout the property write path to help diagnose failures, including the specific error when opening files for write access

---

## [3.12.1] - 2026-01-26

### Fixed
- **Memory leak from thumbnail loading**: Fixed severe memory leak where navigating between folders would repeatedly request thumbnails for the same files, causing RAM usage to grow unbounded (8GB+ observed). Added a global LRU thumbnail cache with 200 entry limit (~6MB max), request deduplication for concurrent loads, and 5-minute TTL. Same file previously requested 100+ times now makes a single IPC call. Cache is automatically invalidated when files are moved, renamed, or deleted

---

## [3.12.0] - 2026-01-23

### Added
- **Type generation script**: New `npm run gen:types` command that loads `SUPABASE_ACCESS_TOKEN` from `.env` file and regenerates TypeScript types from the live database
- **SolidWorks service versioning**: The SolidWorks service now reports its version, and the app checks for compatibility. Version mismatch warnings appear in the Service tab when the service is outdated or incompatible, with clear instructions to rebuild
- **Metadata preservation when copying**: Copying files now preserves part number, description, and revision from the source file. Metadata is copied from pending local edits if present, otherwise from synced server data
- **Checkout protection for destructive operations**: Files checked out by other users are now protected from delete, move, and rename operations. Commands show clear error messages indicating which files are locked and by whom. Context menu items appear disabled with "(locked)" indicator when selection includes files checked out by others. Drag-and-drop moves show "not allowed" cursor for locked files
- **Document Manager-only mode**: The SolidWorks service can now run without a full SolidWorks installation. Users with just the Document Manager API license key can read/write file properties, extract BOMs, get configurations, read references, and extract previews. A new "Feature Availability" collapsible section in the Service tab shows which features work in each mode. Operations requiring full SolidWorks (exports, mass properties, Pack and Go, etc.) now return clear error messages with `SW_NOT_INSTALLED` error code instead of failing silently

### Fixed
- **Delete from server keeps file read-only**: Fixed issue where deleting a checked-in file from the server while keeping the local copy would leave the file read-only. Local-only files are now correctly made writable after the server deletion
- **Sub-assemblies stay read-only after folder checkout**: Fixed issue where sub-assemblies and parts loaded as components of an open assembly would remain read-only in SolidWorks after checking out the folder. The checkout now updates the read-only state for all loaded documents, not just those with visible windows
- **SolidWorks checkout not clearing read-only state**: Fixed issue where checking out an assembly file that's open in SOLIDWORKS would fail to clear the read-only flag, requiring users to close and reopen the file to edit it. The health check before `setDocumentReadOnly` was spawning a new thread that would time out when assemblies with components were open, even though SOLIDWORKS was actually responsive. Removed the overly strict health check since `ExecuteSerialized()` already provides proper retry logic
- **Folder deletion not working for folders with special characters**: Fixed issue where deleting folders with spaces or parentheses in their names (e.g., "New Folder (3)") would appear to succeed but the folder would reappear after refreshing. The server-side soft delete was failing silently due to improper query escaping
- **Schema idempotency**: Fixed `10-source-files.sql` not being fully idempotent - `SELECT drop_function_overloads()` calls were returning result sets that interfered with Supabase SQL Editor execution. Changed to `DO/PERFORM` blocks. Added migrations section for columns that may be missing from existing databases (`configuration_revisions`, `endpoint`, `restic_password_encrypted`, etc.)

### Changed
- **Removed type workarounds**: Cleaned up `as any` type casts for `folders` table, `move_file` RPC, and `create_default_workflow` RPC now that types are regenerated
- **Bulk delete performance overhaul**: Large file deletions no longer use optimistic UI updates. Files now remain visible with spinners during the deletion process, and both the file tree and main browser update together when the operation completes. This prevents visual inconsistencies where files would disappear then reappear if deletion failed
- **Folder move reliability**: Moving folders now releases Document Manager file handles before the operation, cancels any queued thumbnail extractions, and checks for ongoing file operations (downloads, syncs) before proceeding. Previously, moves could fail with EPERM errors when files inside the folder were being processed
- **Rename/move error handling**: Rename and move operations now detect locked files and identify the blocking process (e.g., "Cannot rename: file is in use by SLDWORKS.exe"). Operations retry up to 3 times with backoff before failing
- **Folder copy accuracy**: Copying folders now accurately reports the total number of files copied (not just the folder count) and shows proper progress. Nested files inside copied folders are immediately visible in the UI without requiring a refresh
- **Multi-machine folder sync**: When another user moves a folder, the app now batches all file location updates into a single render instead of processing each file individually. This prevents UI freezes when large folders are moved by teammates

### Removed
- **Speculative parent assembly warning**: Removed the warning toast "Some files may have parent assemblies still checked out" that appeared when checking in parts or assemblies. This warning was overly aggressive and triggered false positives - it would warn even when the checked-out assemblies had nothing to do with the files being checked in

---

## [3.11.0] - 2026-01-22

### Added
- **Collapse all folders in vault**: Right-click context menu on a vault now includes "Collapse All Folders" option to collapse every expanded folder in the vault at once
- **Serial number generation confirmation**: Clicking the generate serial number button now shows a preview popup with the next number before committing. Click the green checkmark to confirm, or click away to cancel. This prevents accidental serial number generation and wasted numbers
- **Right-click context menu for Pending pane**: All rows in the Pending sidebar view now support right-click context menus with actions appropriate to each file type:
  - Open Files / Selected Items: Open, Show in Explorer, Copy Path
  - New Files: Open, Show in Explorer, Copy Path, Check In, Delete
  - Checked Out (mine): Open, Show in Explorer, Copy Path, Check In, Discard
  - Checked Out (others): Open, Show in Explorer, Copy Path, Force Release (admin)
  - Deleted from Server: Open, Show in Explorer, Copy Path, Re-upload, Delete Local

### Changed
- **Standardized Pending pane hover behavior**: Removed inconsistent blue underlined link-style hover from file names in the Pending view. All rows now use a consistent subtle highlight effect on hover, matching the main file browser behavior
- **Item number box sizing**: The item number input box width is now calculated based on the serialization settings (prefix + digits + suffix), ensuring consistent alignment across all rows
- **Tab placeholder text**: Changed the tab number placeholder from "001" to "tab" to make it clearer when no tab number has been assigned
- **Tab number hover effect**: The inline tab number input now shows the same hover box effect as the item number when hovering over the cell

### Fixed

- **Serial number preview showing tab number**: Fixed the serial number preview incorrectly showing a sample tab number (e.g., "BR-00001-001") when tabs were enabled, even though generation only produces the base number. Preview now correctly shows just the base number that will be generated
- **BOM extraction hanging for assemblies**: Fixed issue where viewing the Bill of Materials for SolidWorks assemblies would hang for ~30 seconds and fail. The orphaned process watchdog was incorrectly killing a background SolidWorks process spawned by the Document Manager API during reference resolution. The watchdog now pauses during BOM and reference extraction operations
- **BOM items showing empty**: Fixed JSON serialization mismatch where BOM item properties (fileName, filePath, quantity, etc.) were serialized with PascalCase but the frontend expected camelCase, resulting in empty/undefined values
- **Tab number input validation**: Fixed confusing placeholder text in configuration tab number inputs that showed "-XXX", causing users to think they needed to type the dash. Placeholder now shows "001" (matching configured digit padding). Added input validation to only allow digits and limit to the configured number of digits (default 3). Secondary sanitization layer strips any invalid characters before writing to SOLIDWORKS properties
- **Tab bar disappearing on Pending view**: Fixed the browser tab bar disappearing when navigating to the Pending, History, or Trash sidebar views. The tab bar now remains visible for all views that display the file browser
- **Open Files assembly expand arrow not showing**: Fixed the expand/collapse chevron not appearing next to assemblies in the Pending View's Open Files section. The SolidWorks service returns file types with capitalized names ("Assembly") but the frontend checked for lowercase ("assembly"), causing the comparison to always fail
- **Duplicate preview in bottom panel**: Fixed SolidWorks files showing two previews stacked on top of each other in the Preview tab. Both the SWDatacardPanel and the generic preview block were rendering simultaneously

### Removed
- **Legacy SolidWorks service folders**: Removed empty legacy folders from `solidworks-service/` that were left over from project renaming (`BluePDM.SolidWorks`, `BluePDM.SolidWorksService`, `BluePLM.SolidWorks`)

---

## [3.10.4] - 2026-01-21

### Fixed
- **Auto-update not working**: Fixed missing version bump in package.json for 3.10.3 release, which prevented auto-update from detecting newer versions

---

## [3.10.3] - 2026-01-21

### Fixed
- **SolidWorks DM license key exposed in logs**: Removed logging of Document Manager license key prefix from SolidWorks service startup and configuration. Log files no longer contain any part of the license key value

---

## [3.10.2] - 2026-01-21

### Fixed
- **Multi-config export overwrites files**: Fixed issue where exporting a file with multiple configurations as STEP or STL would overwrite previous exports when configurations don't have unique tab numbers and the filename pattern doesn't include `{config}`. Now automatically appends `_(configName)` to the filename when a collision is detected (e.g., `BR-100_RevA.step`, `BR-100_RevA_(Tall).step`, `BR-100_RevA_(Short).step`)

---

## [3.10.1] - 2026-01-21

### Fixed
- **File rename drops extension**: Fixed issue where renaming a checked-out file via the client UI would remove the file extension if the user only typed a new base name. Now the original extension is automatically preserved when no extension is provided in the new name (e.g., renaming "PartA.sldprt" to "PartB" now correctly results in "PartB.sldprt")

---

## [3.10.0] - 2026-01-16

### Added
- **Local assembly BOM viewing**: Configuration BOM dropdown now works for local-only assemblies and synced assemblies without extracted references:
  - Fetches BOM data directly from SolidWorks when files aren't in the database
  - Automatically enriches BOM items with metadata from matching local vault files (part numbers, descriptions, revisions)
  - Falls back to SolidWorks service when database returns empty results for synced assemblies
  - Shows file type icons, quantities, and available metadata for all components
- **Auto-scroll when dragging files**: Dragging files near the top or bottom edge of the file tree now automatically scrolls the view. Scroll speed increases as you move closer to the edge, making it easy to move files across large folder structures
- **Orphaned file detection and cleanup**: When another user deletes files from the vault, those files now show as "orphaned" (deleted from server) on your machine instead of appearing as new unsynced files. This makes it clear which local files are stale vs genuinely new:
  - Files previously synced but deleted by another user → marked with `deleted_remote` status (red highlight)
  - Files you created locally that were never synced → marked as `added` (green highlight)
  - Right-click context menu option "Discard Orphaned" to remove orphaned files
  - New setting in Vault Settings: "Auto-discard orphaned files" (off by default) to automatically clean up orphaned files on vault load
- **Active Files hierarchical view**: The Active Files section in the Pending tab now displays open SolidWorks files in a structured hierarchy:
  - Files are sorted by type (assemblies first, then parts, then drawings) and alphabetically within each type
  - Open assemblies show their referenced parts/sub-assemblies as collapsible children with an expand/collapse chevron
  - Child count badge shows how many components are open for each assembly
  - Clicking a file name navigates to the file location in the file browser AND highlights/selects it
  - Removed the "R/O" (read-only) badge for cleaner display
- **Filter downloaded folders**: New filter button above the vault list to hide folders with no downloaded files. Click "Filter" to show only folders containing at least one downloaded file - useful for focusing on your local working set in large vaults with many cloud-only files
- **Collapsible sections in Pending Changes**: All sections in the Pending Changes tab (Active Files, New Files, Checked Out Files, Checked Out by Others, Deleted from Server) now have expand/collapse toggles. Click the section header to collapse or expand - useful for focusing on specific file categories

### Improved
- **BR number generation UX**: Enhanced the item number cell with better usability:
  - Minimum width on empty item number boxes (no longer tiny when showing just "-")
  - More padding between item number text and the generate button to prevent accidental clicks
  - New inline confirmation: clicking the sparkle button now shows the next BR number preview with a confirm checkmark that expands smoothly from the box. Click outside to cancel

### Fixed
- **Active Files assembly expand arrow not showing**: Fixed the expandable chevron arrow not appearing next to assemblies in the Active Files section. Assembly files now always show the expand arrow, and clicking it loads the referenced components on-demand with a loading spinner. Previously, the arrow only appeared if references were pre-loaded successfully during initial load
- **Text selection in editable cells triggering file drag**: Fixed issue where clicking and dragging to select text in description, revision, item number, or tab number cells would initiate a file drag operation instead of text selection
- **Inconsistent avatar colors in file browser**: Fixed avatar fallbacks (initials in circles) appearing nearly transparent in file/folder lines while showing proper colored backgrounds in organization profiles. All avatar fallbacks now use consistent, visible colored backgrounds based on the user's email/name

---

## [3.9.0] - 2026-01-16

### Added
- **Real-time server sync for file moves**: Moving a checked-in file to a different folder now immediately updates the server `file_path`. Previously, moved files would appear as "new local" at the destination and "cloud-only" at the old location. Now the server reference is updated atomically before the local move, ensuring consistent state across all users
- **PDF export filename patterns**: PDF exports for SolidWorks drawings now use the same filename pattern system as STEP/STL exports. The exported PDF filename follows the pattern configured in Settings → Export Options (e.g., `{partNumber}_Rev{rev}.pdf`). PDM metadata (part number, description, revision) from the drawing is passed to the export and used as fallback when SolidWorks file properties are empty

### Fixed
- **Pinned folders show only folder name**: Pinned folders now display just the folder name instead of the full path. Full path is still visible on hover
- **SolidWorks files from templates opening as templates**: Fixed issue where new SolidWorks files created from templates (`.prtdot`, `.asmdot`, `.drwdot`) would still behave as templates when opened in SolidWorks. The fix uses the SolidWorks API to properly convert template metadata to document metadata instead of simply copying the file
- **Notification badge clipping**: Fixed notification badge getting clipped when the activity bar is collapsed. Badge now renders above other elements with proper overflow handling
- **Pending reviews not showing in notifications**: Fixed bug where pending review requests would show in the badge count but not appear in the Notifications view after navigating away and back. Pending reviews are now always loaded on mount
- **Window drag region on right side of top bar**: Fixed the area to the right of the search bar not being draggable to move the window. The right-side controls container was expanding to fill available space; now constrained to fit content only

### Changed
- **Context menu reorganization**: Right-click context menu is now more compact with grouped submenus:
  - "File Actions" groups: Show in Explorer, Copy Path, Copy Folder Path, Pin, Rename
  - "Edit" groups: Copy, Cut, Paste
  - "Export" groups: STEP, IGES, STL, PDF, DXF export options (SolidWorks files only)
  - "More Actions" expandable section at the bottom contains collaboration and metadata actions - click the arrow to reveal
- **STL export defaults**: Changed default STL export settings to use custom resolution with 0.05mm deviation and 1° angular resolution (previously used SolidWorks "fine" preset with 10° angle). This provides better mesh quality for 3D printing by default
- **Schema version**: Bumped to v47
  - v47: Added `move_file` RPC for atomic file move operations with checkout validation and activity logging

---

## [3.8.0] - 2026-01-15

### Added
- **Insert into Assembly**: New context menu option for SolidWorks parts and assemblies. Right-click any `.sldprt` or `.sldasm` file → "Insert into Assembly" shows a submenu of currently open assemblies in SolidWorks. Select one to add the part/assembly as a component at the origin
- **Create SolidWorks files from templates**: New "New .sldprt", "New .sldasm", "New .slddrw" options in the empty area and folder context menus. Each shows a submenu of available templates from the configured document templates folder (`.prtdot`, `.asmdot`, `.drwdot` files). Created files appear instantly in the file browser without waiting for file watcher refresh
- **Drawing revision propagation**: When a drawing is checked in, its revision is automatically propagated to the `configuration_revisions` field of all referenced parts/assemblies. This enables tracking which drawing revision corresponds to each configuration of a part
- **Drawing metadata lockout settings**: New settings in Settings → Integrations → SolidWorks → Drawing Metadata:
  - **Lock drawing revision**: Prevent editing revision on drawings (comes from revision table)
  - **Lock drawing item number**: Prevent editing item number on drawings (inherited from model)
  - **Lock drawing description**: Prevent editing description on drawings (inherited from model)
  - Locked fields show a visual indicator and tooltip explaining the lockout
- **Copy folder path**: New "Copy Folder Path" option in file context menu copies the directory portion of the file path (without the filename)

### Performance
- **Faster check-in and first check-in**: Removed unnecessary SOLIDWORKS Document Manager operations from check-in and first check-in (sync) commands. Previously, check-in would call `getDocumentInfo`, `saveDocument`, and write metadata to every SW file via Document Manager, causing significant slowdowns when checking in folders. Now check-in only: computes hash, uploads changed content, updates server, and sets read-only. Metadata should be saved to SW files during editing via "Save to File" button - check-in sends `pendingMetadata` to the server database only

### Fixed
- **Sticky hover state on checkout avatars**: Fixed issue where the notification bell hover state could get "stuck" on checkout avatars in virtualized lists when scrolling quickly. Now uses pointer events with periodic hover state verification
- **Empty context menu positioning**: Context menu for empty areas now properly adjusts position to stay within viewport bounds, matching the behavior of the file context menu

### Changed
- **No checkout required for move/cut**: Files can now be moved (drag-and-drop) and cut (Ctrl+X) without being checked out first. This simplifies file organization workflows - checkout is still required for editing file content
- **Schema version**: Bumped to v46
  - v46: Added `configuration_revisions` JSONB column to files table for tracking per-configuration revisions from drawing releases

---

## [3.7.1] - 2026-01-14

### Added
- **Inline tab number editing**: Edit tab numbers directly in the Item Number column for SolidWorks files. When the Tab column is hidden, a compact tab input appears inline next to the base part number. The input stays visible even when configurations are expanded

### Changed
- **Tab column visible by default**: The "Tab" column is now visible by default in the file browser for new users

---

## [3.7.0] - 2026-01-14

### Added
- **SOLIDWORKS License Management**: Organization-wide license management system for SOLIDWORKS serial numbers
  - **Admin license inventory**: Add, edit, and delete licenses with serial number, nickname, type (standalone/network), product name, seats, purchase/expiry dates, and notes
  - **User assignment**: Assign licenses to organization users with searchable dropdown
  - **Registry push**: Push license activation to local machines via Windows registry with automatic admin privilege detection
  - **Status tracking**: Visual badges show Unassigned (gray), Assigned (yellow), and Active (green) states
  - **Security**: Serial numbers masked by default with click-to-reveal for admins only
  - **Realtime sync**: License and assignment changes sync instantly across all connected users
- **Version note editing**: Edit notes on any historical version while a file is checked out. Click the pencil icon or existing note text in the History tab to edit. Notes sync to the server immediately when saved, or are queued for sync on check-in if the server is unreachable
- **Pending check-in notes**: Add a note for the upcoming version before check-in. The note appears in the "Local Changes" section of the History tab and is saved as the version comment when you check in
- **File watch notifications**: Watch files to receive notifications when they're checked in, checked out, or have state changes. Right-click any synced file → "Watch File" to subscribe. Configurable notification preferences per file
- **Notify collaborators**: New "Notify Someone" option in file context menu to send notifications about files to team members with custom messages
- **Version metadata snapshots**: Each file version now stores a snapshot of the part number and description at check-in time, preserving historical metadata values independent of current file state

### Fixed
- **Rollback version display**: Rolling back to an older version (e.g., V2 from V3) now correctly shows "V2 Local (Rolled back)" in the versions tab instead of incorrectly displaying a phantom "V4" pending version. The rolled-back version is properly highlighted as the local version
- **SolidWorks drawing metadata inheritance**: Drawings that use PRP references (`$PRP:"PropertyName"`) to inherit metadata from their referenced parts/assemblies now correctly display resolved values instead of raw PRP syntax. The system:
  - Detects PRP references or empty drawing metadata during sync
  - Automatically resolves values from the first referenced model (deterministic)
  - Stores resolved metadata in the database while preserving the drawing as source of truth
  - Supports backfilling existing drawings via "Sync SW Metadata" context menu
- **Drawing reference extraction**: SolidWorks drawings (`.slddrw`) are now included in reference extraction during sync and check-in. Drawing→model relationships are stored in `file_references` table with type `'reference'` (distinct from assembly `'component'` relationships)

### Changed
- **Schema version**: Bumped to v45
  - v44: SOLIDWORKS license management tables, RLS policies, and helper functions
  - v45: file_versions stores part_number and description per version

---

## [3.6.1] - 2026-01-13

### Fixed
- **Schema version mismatch**: App now correctly expects schema v43 (was missing from 3.6.0 build)

---

## [3.6.0] - 2026-01-13

### Added
- **Per-part vendor management**: New "Vendors" tab in the right-panel details view for managing suppliers at the part level. Link multiple vendors to any synced file with vendor part numbers, pricing, lead times, minimum order quantities, and notes. Set preferred vendors with star ratings and quick-add new vendors inline
- **Inline serial number generation**: Generate the next serial number directly from the Item # column in the file browser. Hover over any checked-out file to reveal a sparkle button, or click to edit and use the button in the input field. Auto-saves to SolidWorks files immediately

### Performance
- **Optimized backup status checks**: Backup status is now computed incrementally instead of re-checking all snapshots on every poll. Status summary (last backup time, snapshot count) is cached and only updated when new snapshots are detected
- **Memoized file tree items**: FileTree and VaultTreeItem components now use React.memo with custom comparators to prevent unnecessary re-renders during file operations

### Fixed
- **Double version increment on metadata save**: Fixed bug where saving metadata to a SolidWorks file during checkout (via "Save to File" or datacard edits) would cause version to increment twice on check-in. The checkin_file RPC now detects if a version was already created during the checkout session and skips duplicate version creation
- **Item number not saving to SolidWorks file**: Serial numbers generated via the new inline generate button are now immediately written to the SolidWorks file (not just stored as pending metadata)

### Changed
- **Schema version**: Bumped to v43

---

## [3.5.0] - 2026-01-12

### Added
- **STL Export Quality Settings**: New export options in Settings → Export Options for STL files:
  - **Resolution presets**: Coarse (faster, smaller), Fine (recommended for 3D printing), or Custom
  - **Custom deviation/angle**: Fine-grained control over mesh quality when using Custom resolution
  - **Binary/ASCII format**: Toggle between compact binary STL or human-readable ASCII format
- **File Operation Tracker**: New DevTools panel showing real-time progress of file operations (checkout, checkin, sync) with step-by-step timing breakdowns for debugging performance issues
- **Serial number race condition protection**: New `update_serialization_settings_safe` RPC function prevents counter overwrites when multiple users generate part numbers simultaneously

### Performance
- **Serial file operation queue**: Checkout, checkin, sync, download, and discard operations now execute serially through a queue system. This prevents overlapping operations, provides cleaner progress feedback, and eliminates race conditions when rapidly clicking multiple files
- **Batch setReadonly calls**: File operations now collect all paths and make a single IPC call to set file permissions, instead of one call per file
- **Incremental flush optimization**: For large batches (50+ files), incremental UI updates are skipped during processing to avoid expensive React re-renders. Final update happens once at completion
- **Backup panel two-phase loading**: Config loads first (~100ms) so the UI renders immediately, while snapshots load in the background (~30s for large repositories). Previously the entire panel was blocked until snapshots finished loading
- **Debounced realtime updates**: Local file modifications are tracked for 5 seconds to prevent stale realtime events from reverting local changes

### Fixed
- **Metadata property priority**: "Number" property is now checked first when extracting part numbers from SolidWorks files. Previously "Base Item Number" was checked first, which could contain legacy/template values that incorrectly overrode user edits saved via "Save to File"
- **Cross-machine checkout release**: Releasing a checkout from a different machine now properly updates the local UI. Previously, if you checked out a file on Machine A and released it from Machine B, Machine A would still show the file as checked out until refresh
- **Pending metadata preserved on realtime updates**: Files with unsaved local edits (pending metadata) are now protected from realtime event overwrites. This fixes the bug where typing in a datacard field could be interrupted by a stale database update
- **Part number not clearing on discard**: Clearing the part number field in the datacard now properly persists `null` instead of being ignored. Previously, clearing a field would revert to the original value on the next update
- **Metadata merged on clear**: When pending metadata is cleared after save, the values are now merged into pdmData so the UI continues showing the saved values without requiring a refresh

### Changed
- **hasPendingConfigChanges → hasPendingMetadataChanges**: Renamed function to reflect that it now checks ALL pending metadata (part number, description, revision) not just config-specific changes
- **Schema version**: Bumped to v42

---

## [3.4.0] - 2026-01-10

### Added
- **Notification Center**: Full notification system with real-time updates and categorized notifications
  - **Categories**: Reviews, Change Control, Purchasing, Quality, Workflow, System, and Collaboration
  - **Pending reviews panel**: View and respond to reviews directly from notifications
  - **Notification preferences**: Per-category toast and sound settings in Settings → Notifications
  - **Quiet hours**: Suppress notifications during configurable time windows
  - **Priority levels**: Low, Normal, High, and Urgent with visual badges
  - **Bulk actions**: Mark all as read, delete individual or clear all notifications
  - **Create custom notifications**: Admins can send custom notifications to specific users
- **Push to All Users (Sidebar Settings)**: Admins can force-push their sidebar configuration to all organization members, overriding individual customizations. Includes confirmation dialog with warning about overwriting user settings

### Changed
- **Sidebar group toggle cascades to children**: When disabling a custom group, all child modules within that group are now also disabled. When enabling a group, all children are enabled. Previously, toggling a group only affected the group visibility, leaving children in their original state
- **Push to All Users modal**: Improved modal styling with solid backgrounds for better readability (was semi-transparent)

### Fixed
- **Folder UI not updating after download**: Folders now immediately turn green when all cloud files are downloaded, instead of requiring an app restart. The folder icon color is now derived from computed child metrics (`isFolderSynced`) rather than stale folder metadata (`diffStatus`). This architectural fix also ensures folder icons update correctly for:
  - Downloading individual files from a cloud-only folder
  - Mixed folders (some cloud, some synced) showing correct synced state
  - Delete local files operation (previously fixed, now verified consistent)
- **Folder disappearing after "Delete local files"**: Folders containing cloud-only files now remain visible as cloud-only (gray icon) instead of disappearing. Delete command now preserves folders when they have cloud children remaining

### Performance
- **O(N) folder metrics computation**: Fixed O(N²) folder metrics computation - now O(N) single pass via pre-computed Map. Previously 250,000 iterations per render, now 1,000
- **Custom memo comparator**: Added custom memo comparator to VirtualizedTreeRow comparing 15 relevant props instead of 40+, dramatically reducing re-renders
- **Consolidated folder metrics**: Eliminated duplicate folderMetrics computation (was running twice per state change), single source of truth in useVaultTree
- **Set-based selection checks**: Added O(1) selection checks in FileTree using Set instead of O(N) array.includes
- **Selective Zustand selectors**: All tree item, sidebar, and activity bar components now use selective selectors instead of subscribing to the entire store
- **File tree virtualization**: Large vaults with thousands of files now render efficiently using react-window virtualization
- **File list virtualization**: List and grid views in the file pane now use virtualization for large directories
- **Memoized tree components**: VirtualizedTreeRow and VirtualizedListRow are wrapped with React.memo to prevent cascading re-renders
- **TreeHoverContext**: Refactored hover state management from prop drilling to React Context, isolating hover-triggered re-renders to only the affected components
- **CSS-only button visibility**: Action buttons in tree items now use pure CSS `:hover` selectors for show/hide, eliminating JavaScript overhead
- **Inline action buttons always visible**: Made buttons always visible in file tree for better discoverability (no JS-based hover state)
- **Removed fire-and-forget callbacks**: Delete command now uses proper async/await for reliable state updates

---

## [3.3.2] - 2026-01-09

### Performance
- Fixed folder display in file grid view (path normalization)
- Applied selective Zustand selectors to remaining explorer hooks

---

## [3.3.1] - 2026-01-09

### Performance
- Implemented selective Zustand selectors to reduce unnecessary re-renders
- Added virtualization to file tree for improved performance with large vaults
- Added virtualization to file list for improved performance with large directories
- Memoized tree and list item components to prevent cascading re-renders
- Refactored hover state management from prop drilling to React Context (TreeHoverContext) to eliminate cascading re-renders when hovering action buttons

---

## [3.3.0] - 2026-01-08

### Added
- **Startup splash screen**: New blocking splash screen displays during app initialization showing real-time progress through two stages:
  - **Stage 1 (Core)**: Store hydration, configuration check, session restoration, organization loading, and permissions
  - **Stage 2 (Extensions)**: Extension discovery and activation with 10-second timeout per extension
  - Extensions that fail to load show a warning banner but don't block the app. Users can continue immediately or wait for auto-continue after 5 seconds
- **Slow double-click to rename**: Just like Windows Explorer, you can now single-click a file to select it, then click again (after a short delay) to enter rename mode. This works in both the file tree sidebar and the file pane (list and grid views). The timing window is 400-1500ms between clicks, matching Windows Explorer behavior. Renaming is allowed for:
  - Local-only files (not synced to cloud)
  - Files checked out by you
  - All folders (directories don't require checkout)

### Fixed
- **Complete fix for zombie process on app close**: Fixed all causes of the process not terminating after closing the window:
  - **Update check timer**: The periodic update check interval (every 2 minutes) was not being stopped, keeping the Node.js event loop alive
  - **File watcher**: The chokidar file watcher was not being closed during shutdown
  - **Timeout protection**: Added 5-second timeout to all cleanup operations to prevent hangs during shutdown
  - The app now properly cleans up all child processes, HTTP servers, and connections before exiting
- **App won't restart after close**: Fixed issue where the app would flash briefly (~20ms) then close when trying to restart. This was caused by the previous instance not releasing the single instance lock due to incomplete cleanup
- **Improved shutdown diagnostics**: Logging is now initialized before the single instance lock check, so "another instance running" messages are captured to the log file for debugging

---

## [3.2.1] - 2026-01-08

### Fixed
- **App crash on startup after update**: Fixed critical bug where Extension Host files were not bundled for production builds, causing immediate crash when opening the app after updating to 3.2.0

---

## [3.2.0] - 2026-01-08

### Added
- **Paste files from Windows Explorer**: You can now Ctrl+C files or folders in Windows Explorer and Ctrl+V to paste them directly into BluePLM. Previously only drag-and-drop was supported. Files are copied to the current folder with progress tracking and error handling
- **Extension System Architecture**: New plugin architecture for third-party and first-party extensions
  - **Extension Host**: Isolated Electron renderer process for client-side extension code with per-extension sandboxing and watchdog monitoring
  - **API Sandbox**: V8 isolate pool on organization API servers for server-side extension handlers with rate limits and secure storage
  - **Extension Registry**: Central coordinator for discovery, installation, activation, updates, and rollback
  - **IPC Bridge**: Secure message-passing between Main Process, Extension Host, and App Renderer
  - **Extension Manifest** (`extension.json`): Declarative format for metadata, capabilities, permissions, and contributions (views, commands, settings, API routes)
  - **`.bpx` Package Format**: ZIP-based distribution format for extensions with manifest validation and signing
- **Extension Store Database**: New Supabase schema for publishers, extensions, versions, reviews, reports, and analytics (in `blueplm-site`)
- **Extension Store API**: Cloudflare Workers API for extension publishing, discovery, and management
- **Marketplace UI**: Extension store frontend at marketplace.blueplm.io with search, categories, and publisher dashboards

### Changed
- **Google Drive extension moved to separate repository**: The Google Drive extension is now maintained in its own repository at [blueplm-ext-google-drive](https://github.com/bluerobotics/blueplm-ext-google-drive). This establishes the pattern for all BluePLM extensions to be standalone packages that install from the Extension Store

---

## [3.1.5] - 2026-01-07

### Added
- **Vault setup wizard**: New first-time connection dialog when connecting to a vault. Shows sync stats (files on server vs local), and lets users configure auto-download preferences before syncing begins
- **Wipe local files action**: New "Wipe Local" button in vault settings to delete all local files without disconnecting from the vault. Cloud files remain untouched
- **Sync stats calculation**: New `calculateVaultSyncStats` utility in vault health check to compare local and server file states
- **i18n for vault setup**: Added translations for vault setup dialog in all supported languages (EN, DE, ES, FR, PT, ZH-CN, ZH-TW)

### Changed
- **Vault disconnect preserves files**: Disconnecting from a vault no longer deletes local files. Use the new "Wipe Local" action if you want to remove files
- **Integration status polling**: Background polling now uses "silent" mode to avoid UI flickering from repeated "checking" states
- **Permissions editor toggle-all**: "Toggle all" actions now properly include Source Files permissions for the current vault context
- **Backup status indicator**: Shows yellow "Needs attention" instead of "Not configured" when no vaults are connected
- **Delete vault confirmation**: Now requires typing the vault name twice to prevent accidental deletion

### Fixed
- **Stale pending metadata on checkout**: Checkout now clears any persisted pending metadata from previous checkouts. Previously, stale metadata could incorrectly show in the datacard after re-checking out a file
- **Vault setup not completing**: Fixed issue where vault connections from the welcome screen would not properly mark setup as complete, causing the setup dialog to reappear

---

## [3.1.4] - 2026-01-07

### Fixed
- **SolidWorks service resilience**: Check-in operations now detect when the SolidWorks service crashes or times out and automatically skip remaining SW calls in the batch. Previously, a crashed service would hang the entire check-in operation
- **Auto-download includes folders**: Auto-download setting now properly handles cloud-only folders in addition to files, ensuring complete folder structures are downloaded when enabling auto-sync
- **Processing spinner propagation**: Fixed spinners showing on sibling files instead of child files. Spinners now correctly propagate DOWN to children within a processing folder, not UP to parents

### Changed
- **SolidWorks service logging**: Enhanced diagnostic logging with comprehensive state summaries, command tracking with IDs, queue depth monitoring, and clearer timeout/error reporting for easier debugging

---

## [3.1.3] - 2026-01-07

### Fixed
- **Realtime sync for member attributes**: Fixed issue where team membership, workflow role, and job title changes required a manual refresh to appear. Added realtime subscriptions for `team_members`, `user_workflow_roles`, and `user_job_titles` tables. Admin views now update instantly when any admin makes changes, and affected users receive toast notifications when their roles/teams/titles are modified

---

## [3.1.2] - 2026-01-08

### Fixed
- **Non-admin users unable to sync files**: Fixed RLS policy bug where file insert/update/delete operations used `system:files` permission which didn't exist in the permission system. Only org admins could bypass this check, causing all non-admin users (engineers, etc.) to see "0 out of N files uploaded" errors. Changed policies to use `module:explorer` which is properly configurable via team permissions

---

## [3.1.1] - 2026-01-07

### Added
- **Vault migration dialog**: User-friendly dialog shown after major version upgrades when connecting to an existing vault. Runs a health check comparing local files with server state, identifies files with missing storage blobs, and offers one-click "Fix All" to re-sync affected files

### Fixed
- **SolidWorks file downloads failing**: Fixed critical bug where check-in did not upload modified file content to storage. When users checked in files (especially SolidWorks files with metadata writeback), the database was updated with the new content hash but the actual file was never uploaded. This caused all downloads of those files to fail with HTTP 400 errors. Check-in now properly uploads file content to storage when the hash changes.
- **Delete local files spinner**: Fixed missing loading spinner when deleting local files. Spinners now appear in the inline action button area (where download/checkout/checkin spinners appear) for list view, grid view, and tree view
- **Upgrade file sync issues**: Fixed issues where users upgrading to 3.1 with existing vault folders would see orphan checkout warnings or "Missing Storage Files" dialogs. Files with matching content hashes are now recognized as synced regardless of timestamps, and storage blob existence is pre-validated before download attempts

---

## [3.1.0] - 2026-01-07

### Added
- **Clean install on major upgrades**: App data is automatically wiped when upgrading between major versions (2→3, 3→4, etc.) ensuring a fresh start. Clears settings, logs, cache, browser storage, and temp files
- **Unified logging utility**: New `src/lib/logger.ts` with dual output to DevTools console AND Electron app log. Supports error/warn/info/debug levels with category prefixes (e.g., `[Auth]`, `[Realtime]`) for filtering. Debug logging toggleable via `localStorage.setItem('debug', 'true')`

### Changed
- **Console logging cleanup**: Reduced console statements from ~225 to 11 (~95% reduction). Removed subscription status spam, heartbeat logs, JSON dumps, and verbose state tracking. Meaningful logs converted to unified logger

### Fixed
- **Vault display consistency**: Fixed issue where file tree and file pane would show files from existing local folders even when no vault was connected in settings. Now consistently shows "No vault connected" state until a vault is explicitly connected via Settings > Vaults

---

## [3.0.2] - 2026-01-07

### Fixed
- **SolidWorks service bundling**: Fixed path in GitHub Actions workflow (`solidworks-addin` → `solidworks-service`) and corrected extraResources glob pattern so the service executable is properly included in Windows builds

## [3.0.0] - 2026-01-07

### Added

#### Architecture
- **Enterprise folder structure**: Reorganized `src/features/` to mirror database modules (source, items, change-control, supply-chain, integrations, dev-tools, settings)
- **Component layer separation**: `components/core/` (primitives), `components/layout/` (app shell), `components/shared/` (reusable), `components/effects/` (visual)
- **Lazy module loading**: Sidebar views and settings panels load on-demand. Disabled modules never load into memory

#### Zustand Store
- **17 specialized slices**: Decomposed monolithic store into focused slices (files, vaults, workflows, settings, UI, etc.)
- **Versioned migrations**: `src/stores/migrations.ts` with version tracking for safe state upgrades
- **Hydration tracking**: `onRehydrateStorage` callback prevents race conditions on app startup

#### API (v2.0.0)
- **Layered architecture**: Separated into core (types, errors), config, infrastructure (repositories), and HTTP layers
- **Repository pattern**: `FileRepository`, `VaultRepository`, `WebhookRepository` with mappers
- **TypeBox schemas**: Full OpenAPI documentation for all endpoints

#### Database (Schema v36)
- **Modular schema**: Split into `core.sql` + optional modules (`10-source-files.sql`, `20-change-control.sql`, `30-supply-chain.sql`, `40-integrations.sql`)
- **Atomic RPC functions**: `checkout_file`, `checkin_file` with `FOR UPDATE` row locks and built-in activity logging
- **Schema version tracking**: Automatic mismatch warnings between app and database versions

#### Performance
- **Concurrency limiting**: `processWithConcurrency()` utility with configurable worker pools (default: 20 concurrent ops)
- **Batch chunking**: `BATCH_CHUNK_SIZE = 100` for bulk database operations
- **SolidWorks optimization**: Skip service calls for files with cached hashes and no pending metadata
- **Fire-and-forget activity logging**: Non-blocking audit trail creation

#### Terminal
- **60+ CLI commands**: Full command system with categories (navigation, search, file ops, PDM, vault, backup, collaboration, admin, batch)
- **Self-registering commands**: `registerTerminalCommand()` with metadata, usage, examples
- **Command categories**: `help` shows commands grouped by function

### Changed
- **Database schema**: v36 with modular architecture
- **Electron**: v39 (Chromium 142, Node.js 22, V8 14.2)
- **React**: v19
- **Zustand**: v5 with slice architecture
- **Checkout/checkin**: Now use atomic PostgreSQL RPCs instead of multi-step client logic

### Fixed
- **Circular dependency crash**: Fixed "Cannot access 'COLUMN_TRANSLATION_KEYS' before initialization" in FilePane
- **Checkout race conditions**: Atomic RPCs with `FOR UPDATE` locks prevent concurrent checkout conflicts
- **Double activity logging**: RPCs handle logging; removed duplicate client-side logging
- **Store hydration races**: Hooks wait for Zustand rehydration before auto-starting services
- **SolidWorks service reliability**: Polling-based startup confirmation, proper cleanup on app quit

### Removed
- **Legacy fileService.ts**: Consolidated into `src/lib/supabase/files/`
- **Duplicate utilities**: Consolidated 9 copies of `buildFullPath`, 6 copies of `formatBytes` into single source
- **Dead code**: `StatusBar.tsx`, `SolidWorksPreviewPanel.tsx`, unused dependencies (@tanstack/react-query, @tanstack/react-table, clsx)
- **In-memory webhooks**: Now database-backed for persistence

---

## [2.22.0] - 2026-01-01

### Added
- **Per-configuration tab numbers**: Parts/assemblies with multiple SolidWorks configs can have different tab numbers per config (e.g., BR-12345-001, BR-12345-002, BR-12345-003). Datacard shows "Base #" (shared) and "Tab #" (per-config) fields with live preview
- **Export configurations from file browser**: Right-click on expanded configuration rows to export STEP/IGES/STL. Supports multi-select with Ctrl+click and Shift+click to export specific configurations
- **Configurable export filenames**: New Settings → Export Options page to customize exported file naming patterns with tokens like `{partNumber}`, `{config}`, `{rev}`, `{date}`, etc. Example: `{partNumber}_Rev{rev}` produces `BR-101011-394_RevA.step`
- **Bulk Refresh Metadata**: Right-click folders or vault header to refresh SolidWorks metadata for all SW files inside. Shows file count before processing
- **Detect highest serial number**: Admins can scan vault to find highest used serial and set counter accordingly (Settings → Serialization → "Scan Vault")
- **Custom profile picture uploads**: Upload profile pictures in Settings > Profile (PNG/JPG/WebP, max 2MB)
- **Log viewer multi-select**: Select multiple entries with checkboxes, Shift+click for range selection, copy with full content

### Changed
- **Electron upgraded to v39**: Major upgrade bringing Chromium 142, Node.js 22, V8 14.2, plus electron-builder 26 and electron-updater 6.7.3
- **SolidWorks datacard redesigned**: Cleaner 3-column layout (preview, properties, export). Config tabs only appear when needed. Service status is now a subtle indicator dot
- **SolidWorks property saving optimized**: "Save to File" now only writes configs with pending changes and uses batch API. Previously wrote all configs individually (N API calls), now makes 1 call for only changed configs
- **Log viewer toolbar**: Compact two-row layout with inline level counts and grouped controls

### Fixed
- **Slow checkout operations**: Fixed 10-20+ second checkouts by fetching machine info once per batch instead of per-file. Activity logging now fire-and-forget
- **SolidWorks drawing revision not syncing**: Fixed Revision property extraction from .slddrw files (incorrect COM interop types)
- **SolidWorks datacard not showing PDM metadata**: Fixed Item #, Description, Revision fields not loading from database
- **File browser not remembering folder**: Current folder now persists across app restarts
- **Avatar images not loading**: Fixed for Chromium 142 with `referrerPolicy="no-referrer"`
- **Security**: Updated systeminformation to fix Windows command injection vulnerability

### Removed
- Cleaned up dead code (`StatusBar.tsx`, `SolidWorksPreviewPanel.tsx`), unused dependencies (@tanstack/react-query, @tanstack/react-table, clsx), and consolidated duplicate utilities (9 copies of `buildFullPath`, 6 copies of `formatBytes`)

---

## [2.21.0] - 2025-12-31

### Added
- **User "last online" tracking**: Users now have a "last online" timestamp visible in member lists and user profiles. Shows relative time (e.g., "5m ago", "Online now") with a clock icon on its own line for cleaner layout
- **Real-time last online sync**: The "last online" timestamp now updates every 30 seconds via heartbeat, so it stays in sync with the online indicator in the top right
- **Team module defaults in Members & Teams**: Each team now has a "Modules" button to configure which modules are enabled by default for team members. If a user is in multiple teams, they get the union of all enabled modules (if any team enables a module, it's enabled)
- **Full module configuration per team**: Team module defaults now use the same full editor as Settings > Modules. Teams can have their own module order, custom groups, dividers, sub-menus (parent-child relationships), and icon colors - not just enable/disable toggles

### Fixed
- **Auth provider settings not respected on sign-in**: Sign-in screen now respects organization's auth provider settings. If admin disables email/phone sign-in, those options are hidden from the sign-in screen
- **User simulation not respecting team restrictions**: When simulating a user (admin feature), the sidebar now correctly shows only modules enabled for the simulated user's teams, and vaults are filtered based on the team's vault access. This works for both active and pending users
- **Backups failing due to stale repository locks**: Backups now automatically clear stale locks before starting and before applying retention policy. Previously, if a backup was interrupted, subsequent backups would fail with "repository is already locked" error

### Changed
- **Members & Teams UI improvements**: Teams and users in the Members & Teams settings now have a cleaner look with subtle ring borders, hover highlights, and colored left borders on team headers. Expanded teams have a prominent drop shadow effect on all sides to visually "pop out" from surrounding content
- **Team-based permissions architecture**: Admin status is now determined by membership in the "Administrators" team instead of the legacy `role` column. All permissions flow through the team system. The `role` column is deprecated but retained for backward compatibility
- **Lazy loading for modules**: All sidebar views and settings panels are now lazy loaded using React.lazy(). Disabled modules are never loaded into memory, and views are only loaded when navigated to. This significantly reduces memory usage for users who don't need all features
- **Group toggles in Modules settings**: Custom groups can now be toggled on/off. Disabling a group hides all modules within it from the sidebar
- **"In Development" modules can be toggled**: Modules marked as "In Development" (previously "Coming Soon") can now be enabled/disabled. They appear slightly greyed out in settings and show an "In Dev" badge in the sidebar
- **Inline vault selector for Source Files permissions**: In both "View Net Permissions" modal and team permissions editor, the vault selector is now inline within the Source Files section instead of a global dropdown. Only Source Files permissions are vault-specific; other modules show global permissions
- **Schema version**: Bumped to v24

### Removed
- **Performance Processes tab**: Removed the non-functional "Processes" tab from Performance settings. Module memory tracking was causing performance issues and has been replaced with lazy loading instead
- **Role impersonation from dev tools**: Removed the deprecated Admin/Engineer/Viewer role impersonation feature. User impersonation (simulating a specific user's permissions) remains available for admins
- **Deprecated TeamsSettings and MembersSettings**: Removed the orphaned separate Teams and Members settings pages. All team/member management now goes through the unified "Members & Teams" settings tab

---

## [2.20.3] - 2025-12-31

### Fixed
- **In-app update crashing on macOS**: Fixed auto-update install crashing on Mac. Replaced problematic `quitAndInstall` with `app.relaunch()` + `app.exit()` which is more reliable on macOS

---

## [2.20.2] - 2025-12-31

### Fixed
- **Pending users showing in main list**: Fixed in both MembersSettings and TeamMembersSettings views - users who haven't signed in yet now only appear in "Pending Members" section

---

## [2.20.1] - 2025-12-31

### Fixed
- **Pending users showing in main list**: Users who haven't signed in yet (still pending) now only appear in "Pending Members" section, not duplicated in the main user list

---

## [2.20.0] - 2025-12-31

### Added
- **Per-vault permissions**: Teams and individual users can now have different permission levels per vault. Set "All Vaults (Global)" for org-wide permissions, or select a specific vault for vault-scoped permissions. Example: Engineering team can have admin on Production vault but view-only on Archive vault

### Changed
- **Schema version**: Bumped to v20
- **Permission functions**: `get_user_permissions` and `user_has_permission` now accept optional `vault_id` parameter for vault-scoped checks

---

## [2.19.3] - 2025-12-31

### Fixed
- **User record not created after account deletion**: Fixed critical bug where signing in after "Delete Account" would fail to create the user record in `public.users`. The `ensure_user_org_id` RPC now creates the user record if the auth trigger failed, and applies pending team memberships

### Changed
- **Schema version**: Bumped to v19

---

## [2.19.2] - 2025-12-31

### Fixed
- **Invited users added to wrong team**: Fixed bug where users invited with specific teams (e.g., "Doris") were also incorrectly added to "New Users" team. Now only adds to default team if user has no team memberships yet

### Changed
- **Schema version**: Bumped to v18

---

## [2.19.1] - 2025-12-31

### Changed
- **Admin remove user fully deletes**: Removing a user from the organization now fully deletes them from `auth.users`, allowing clean re-invites without "user already registered" errors
- **Schema version**: Bumped to v17

---

## [2.19.0] - 2025-12-31

### Fixed
- **Multi-vault display bug on sign-in**: Fixed issue where the second vault would show the first vault's files until manually selecting each vault. Root cause was the working directory not updating when `activeVaultId` changed, and stale closure issues in the auto-connect flow
- **Invited users can't see teams/roles**: Fixed critical bug where `handle_new_user` didn't include `org_id` in the `ON CONFLICT UPDATE` clause, so returning users with pending invites never had their org assigned

### Changed
- **Schema version**: Bumped to v13

---

## [2.18.3] - 2025-12-31

### Added
- **Block user feature**: Admins can now block users from the organization. Blocked users cannot rejoin via org code and need an explicit re-invite
- **Regenerate org code**: Admins can regenerate the organization code/slug for security, invalidating all existing org codes

### Fixed
- **Invite flow 403 error**: Fixed RLS policy that queried `auth.users` directly (permission denied). Now uses `auth.jwt()` to get email from JWT token
- **Case-insensitive email matching**: All invite-related email comparisons are now case-insensitive (RLS policies, triggers, and client queries)
- **Re-invite after removal**: When removing a user from the org, their pending invite is now cleaned up properly, allowing them to be re-invited
- **API invite validation**: API now uses case-insensitive email matching and properly cleans up old invites before creating new ones

### Changed
- **Schema version**: Bumped to v12

---

## [2.18.2] - 2025-12-31

### Fixed
- **Backup scheduler not triggering**: Fixed React closure bug where scheduled backups never ran because the scheduler was checking stale config state instead of fetching fresh data from the database

---

## [2.18.1] - 2025-12-31

### Fixed
- **Non-admin inline edit buttons**: Team and workflow role badges are now non-interactive for non-admins (previously appeared clickable but saves would silently fail)

---

## [2.18.0] - 2025-12-31

### Added
- **Realtime permissions sync**: Vault access, team membership, and permission changes now sync instantly without refresh
  - When an admin changes your vault access, you see the update immediately
  - Team membership changes apply in real-time
  - Role changes (admin→engineer, etc.) reflect immediately
  - Toast notifications inform users when their access changes

### Fixed
- **Invite flow not associating organization**: Fixed RLS policy that prevented new users from seeing their pending invite (schema v8)
- **Pending membership not applying on re-login**: Fixed triggers to fire on UPDATE, not just INSERT, so users who failed initial login can retry (schema v9)
- **Ambiguous column reference in triggers**: Fixed `apply_pending_team_memberships` function variable naming conflict

### Changed
- **Schema version**: Bumped to v9

---

## [2.17.5] - 2025-12-31

### Added
- **Change Organization option**: Added "Change Organization" link on sign-in screen to clear stored config and return to setup

---

## [2.17.4] - 2025-12-31

### Changed
- **Schema version**: Bumped to v7 (was missing from v2.17.2/v2.17.3)

---

## [2.17.3] - 2025-12-31

### Added
- **Unassigned users visibility**: Users without teams now show a prominent yellow "Unassigned" badge
- **Default team warning**: Shows warning in Teams tab when no default team is set (users will have no permissions)

### Improved
- **Default team dropdown**: Clearer "Unassigned (no team permissions)" option text

---

## [2.17.2] - 2025-12-31

### Added
- **Default Team for New Users UI**: Admins can now select which team new users are added to in Settings → Team Members → Teams tab
- **Invited users without teams get default team**: Users invited without specific team assignments are now added to the default team (if configured)

### Fixed
- **Schema migration for existing orgs**: Running schema now creates default teams for existing organizations that don't have them

---

## [2.17.1] - 2025-12-31

### Fixed
- **Org code missing slug**: `generateOrgCode` now always includes the organization slug from the current org
- **Legacy org codes without slug**: Added fallback — if org code has no slug but there's only one organization in the database, automatically join it
- **Root cause of "no organization found"**: Users with non-matching email domains and no pending invite can now join via the org slug embedded in org codes

---

## [2.17.0] - 2025-12-31

### Added
- **"New Users" default team**: New organizations automatically get a "New Users" team with Engineer-level permissions
- **Org code join flow**: Users entering an org code can now sign in without a pre-created invite — they're automatically added to the org and default team
- **`join_org_by_slug` RPC**: Database function for joining an organization via org slug (from org code)
- **`default_new_user_team_id` setting**: Admins can configure which team new users (joining via org code) are auto-added to

### Fixed
- **Invited users auth flow**: `on_auth_user_created` trigger now fires on INSERT **and** UPDATE (fixes issue where `inviteUserByEmail` creates auth.users first, then user signs in)
- **Delete account now hard deletes**: `delete_user_account` actually removes records from `auth.users` and `public.users` instead of just soft-deleting
- **Pending membership role handling**: Improved logging shows exact role being assigned from pending_org_members
- **Backup RPC call**: App now calls `apply_pending_team_memberships` RPC as fallback if DB trigger doesn't fire

### Changed
- **Schema version**: Bumped to v6
- **Email domain enforcement**: `join_org_by_slug` respects email domain restrictions if configured

---

## [2.16.10] - 2025-12-30

### Fixed
- **New user auth race condition**: Added retry logic when fetching user profile (handles trigger timing)
- **Invited users not linked to org**: Now checks `pending_org_members` directly if trigger didn't run
- **Session registration fails for new users**: Added retry logic with helpful error message
- **Stuck spinners**: Users now see proper "No Organization Found" screen with helpful guidance

### Changed
- **Invite email button**: Links directly to blueplm.io/downloads instead of auth confirmation URL

---

## [2.16.9] - 2025-12-30

### Added
- **API version tracking**: App now checks if deployed API version matches expected version, shows warnings in Settings → API if outdated

---

## [2.16.8] - 2025-12-30

### Added
- **Invite email includes org code**: Users now receive the Organization Code directly in their invite email — no need to ask admin
- **Email delivery docs**: Added SMTP setup guide (Resend/SendGrid) to prevent invite emails going to spam

### Fixed
- **Re-invite users**: API now automatically cleans up stale auth users when re-inviting, fixing "user already exists" errors
- **API startup logging**: Shows whether service key is configured for invites

### Changed
- **Invite flow**: "Confirm & Download" button redirects to blueplm.io/downloads after account confirmation
- **Email template**: Updated invite template displays org code with copy-friendly formatting

---

## [2.16.7] - 2025-12-30

### Fixed
- **Schema version mismatch**: Updated app to expect schema v3 (was incorrectly set to v1, causing "database newer than app" warnings)

---

## [2.16.6] - 2025-12-30

### Added
- **Sign-In Methods settings**: Admins can control which authentication providers (Google, Email, Phone) are available for team members and suppliers

---

## [2.16.5] - 2025-12-30

### Added
- **Documentation site**: VitePress-powered docs at docs.blueplm.io with auto-deploy on release
- **Docs content**: Getting started guides, admin/user setup, source files, and settings documentation

### Fixed
- **Build**: Isolated docs dependencies to prevent conflicts with API Docker build

---

## [2.16.2] - 2025-12-30

### Changed
- **Schema version**: Bumped to v2 for workflow_roles, job_titles, pending_org_members, vault_users tables

---

## [2.16.1] - 2025-12-30

### Fixed
- **User invite**: Added REST API deployment step to main README and API docs (SUPABASE_SERVICE_KEY required for invite emails)

---

## [2.16.0] - 2025-12-29

### Added
- **Members settings redesign**: Tabbed UI with Users, Teams, Roles, and Titles tabs - each with search and full CRUD
- **Vault access enforcement**: Non-admins only see vaults they have access to; auto-disconnect on revoked access
- **Job Titles**: Display labels for users with inline assignment, create/edit/delete from modal
- **Workflow Roles inline**: Edit user roles directly from user rows; create/edit/delete with color/icon pickers
- **Default Permission Teams**: New orgs get Viewers/Engineers/Administrators with pre-configured permissions
- **Delete Account**: Users can permanently delete their account (Settings → Account) with type-name confirmation
- **Realtime settings sync**: Admin settings changes sync instantly to all connected users
- **Sentry user tracking**: Hashed user/org IDs in error reports (privacy-preserving, consent-based)

### Changed
- **Permissions simplified**: All permissions flow through team membership (removed role selection from dialogs)
- **Create User**: Now includes vault restrictions and optional invite email
- **Email auto-join removed**: Users join via pre-created accounts or organization code only

### Improved
- **Network resilience**: Auto-retry with exponential backoff; friendly error messages for connection issues

### Fixed
- **Clipboard**: Fixed "Write permission denied" in packaged app using Electron native API
- **Contribution count**: Accurate totals (previously capped at 1000)
- **Pending view**: SolidWorks temp files (`~$...`) now hidden
- **Light theme contrast**: Improved visibility of status colors, contribution grid, and UI indicators

---

## [2.15.0] - 2025-12-28

### Added
- **Workflow Roles**: Custom approval roles (Design Lead, QA Manager, etc.) assignable to states, transitions, and gate reviewers
- **Advanced Workflow Features**: State permissions, transition conditions/actions, revision schemes, auto-transitions, workflow tasks, transition approvals, and audit history
- **Workflow Canvas**: Right-click to create states, infinite canvas, elbow paths with draggable handles, connection point snapping, snap-to-grid/alignment with visual guides
- **History navigation**: Click history entries to reveal files in browser
- **Schema version checking**: Startup warnings for database migrations, status in Settings

### Changed
- **Workflow model simplified**: Gates replaced with transition approvals (industry-standard)

### Fixed
- Sidebar submenu animation drift
- Workflow: drag-to-connect, elbow paths, transition persistence, spline perpendicularity, control points, color picker layout

---

## [2.14.2] - 2025-12-28

### Fixed
- **Recursive subassembly fetching**: Fixed "too many connections" and performance issues
  - Batch queries with chunking (50 items at a time)
  - Proper connection management in recursive loops
  - ~10x faster for large assemblies
- **File metadata refresh**: Metadata now properly refreshes after file operations
  - Observer pattern notifies FileBrowser of changes
  - Timestamps and statuses update without page reload
- **File locking edge cases**: Better handling of lock/unlock failures
  - Graceful degradation when lock already held
  - Clear error messages for permission issues

---

## [2.14.1] - 2025-12-27

### Fixed
- **Subassembly support**: Deep recursive loading for multi-level assemblies
- **File status indicators**: Real-time sync status icons in file browser
- **Search performance**: Debounced search with proper cleanup

---

## [2.14.0] - 2025-12-27

### Added
- **Bill of Materials (BOM)**: Generate and export BOMs from assemblies
- **File comparison**: Side-by-side diff view for file versions
- **Bulk operations**: Select multiple files for batch checkout/checkin

### Changed
- **File browser redesign**: Tree view with drag-and-drop support
- **Settings organization**: Grouped into logical categories

---

## [2.13.0] - 2025-12-26

### Added
- **Workflow Designer**: Visual canvas for creating approval workflows
- **Custom states**: Define workflow states with colors and icons
- **Transition rules**: Configure who can move files between states

### Fixed
- **Memory leaks**: Proper cleanup of event listeners and subscriptions
- **Offline mode**: Better handling of network disconnection

---

## [2.12.0] - 2025-12-25

### Added
- **Team permissions**: Granular permission system based on team membership
- **Vault access control**: Restrict vault visibility per user/team
- **Activity feed**: Real-time updates of organization activity

### Changed
- **Authentication flow**: Simplified login with magic links
- **User onboarding**: Guided setup for new organizations

---

## [2.11.0] - 2025-12-24

### Added
- **SolidWorks integration**: Native add-in for direct PDM operations
- **eDrawings viewer**: Built-in 3D preview for CAD files
- **Thumbnail generation**: Automatic preview images for supported formats

### Fixed
- **Large file uploads**: Chunked uploads for files over 50MB
- **Version conflicts**: Better merge resolution for concurrent edits

---

## [2.10.0] - 2025-12-23

### Added
- **RFQ module**: Request for Quote generation and tracking
- **Supplier management**: Vendor database with contact info
- **Part costing**: Track costs and pricing history

### Changed
- **Database schema**: Optimized indexes for faster queries
- **API performance**: Reduced response times by 40%

---

## [2.9.0] - 2025-12-22

### Added
- **Custom fields**: User-defined metadata fields for files
- **Search filters**: Advanced search with field-specific filters
- **Export options**: CSV and Excel export for reports

### Fixed
- **File sync conflicts**: Improved conflict detection and resolution
- **UI responsiveness**: Fixed lag in large file listings

---

## [2.8.0] - 2025-12-21

### Added
- **Notifications**: In-app notifications for file changes and mentions
- **Comments**: Thread-based discussions on files and versions
- **@mentions**: Tag users in comments for notifications

### Changed
- **Navigation**: Streamlined sidebar with collapsible sections
- **Dark mode**: Improved contrast and readability

---

## [2.7.0] - 2025-12-20

### Added
- **Version history**: Complete audit trail of all file changes
- **Rollback**: Restore files to any previous version
- **Compare versions**: Visual diff between file versions

### Fixed
- **Download resumption**: Resume interrupted downloads
- **Upload validation**: Better file type and size checks

---

## [2.6.0] - 2025-12-19

### Added
- **Multi-vault support**: Manage multiple storage vaults per organization
- **Vault migration**: Move files between vaults
- **Storage analytics**: Track usage per vault and user

### Changed
- **File organization**: Folders now support nesting up to 10 levels
- **Search scope**: Search across all vaults or specific vault

---

## [2.5.0] - 2025-12-18

### Added
- **Google Drive integration**: Sync files with Google Drive folders
- **Auto-sync**: Automatic synchronization on file changes
- **Conflict resolution**: Handle sync conflicts gracefully

### Fixed
- **OAuth flow**: Fixed token refresh issues
- **Large folder sync**: Pagination for folders with 1000+ files

---

## [2.4.0] - 2025-12-17

### Added
- **Part numbering**: Configurable serial number schemes
- **Auto-increment**: Automatic part number generation
- **Number validation**: Prevent duplicate part numbers

### Changed
- **Part creation flow**: Streamlined form with smart defaults
- **Validation rules**: Configurable per organization

---

## [2.3.0] - 2025-12-16

### Added
- **Organization settings**: Company profile, logo, and branding
- **User management**: Invite, remove, and manage user roles
- **Audit logging**: Track all administrative actions

### Fixed
- **Permission checks**: Consistent enforcement across UI
- **Session handling**: Fixed logout issues on token expiry

---

## [2.2.0] - 2025-12-15

### Added
- **File preview**: In-browser preview for images, PDFs, and text files
- **Quick actions**: Context menu for common file operations
- **Keyboard shortcuts**: Navigate and operate with keyboard

### Changed
- **Upload UX**: Drag-and-drop with progress indicators
- **Error handling**: More descriptive error messages

---

## [2.1.0] - 2025-12-14

### Added
- **Checkout/Checkin**: File locking for collaborative editing
- **Lock status**: Visual indicators for locked files
- **Force unlock**: Admin ability to release stuck locks

### Fixed
- **Concurrent edits**: Prevent data loss from simultaneous saves
- **Lock cleanup**: Auto-release locks on session timeout

---

## [2.0.0] - 2025-12-13

### Added
- **Complete rewrite**: New architecture with React + Electron
- **Supabase backend**: PostgreSQL with real-time subscriptions
- **Modern UI**: Tailwind CSS with dark mode support
- **Cross-platform**: Windows, macOS, and Linux support

### Changed
- **Authentication**: Moved to Supabase Auth
- **Storage**: Cloud-first with local caching
- **Performance**: 5x faster file operations

---

## [1.0.0] - 2025-12-01

### Added
- Initial release
- Basic file management
- User authentication
- Organization support
