# Clearing a field must write an empty property, not remove it

**Status:** specified, not implemented. Every change below is in `solidworks-service/`, which another
agent owns; nothing in this document has been applied. The TypeScript side is implemented and shipped
under this decision already, so the two halves currently disagree — see "What happens until this
lands".

## The decision

When a user clears a metadata field in BluePLM, the custom property must **remain in the SolidWorks
file with an empty value**. It must not be removed from the document.

Two reasons, both about the file rather than about BluePLM:

- A drawing title block linked with `$PRP:"Description"` renders blank against a property that
  exists and is empty. Against a property that is not there at all it can break, and what it breaks
  into is a drawing note reading `$PRP:"Description"` on a released print.
- A property that stays visible in SolidWorks' own Summary Information dialog is what a user expects
  after clearing a field. Removing the row is what they expect from deleting the property, which is a
  different action they did not take.

## What the service does today

Four code paths turn an empty incoming value into a delete. All four were written for the same
reason and all four need the same change.

| File | Method | Lines | Call |
|---|---|---|---|
| `DocumentManagerAPI.cs` | `SetCustomProperties` (file scope) | ~1470–1479 | `dynDoc.DeleteCustomProperty(key)` |
| `DocumentManagerAPI.cs` | `SetCustomProperties` (configuration scope) | ~1528–1537 | `config.DeleteCustomProperty(key)` |
| `DocumentManagerAPI.cs` | `SetCustomPropertiesBatch` | ~1737–1747 | `config.DeleteCustomProperty(key)` |
| `SolidWorksAPI.cs` | `WriteCustomProperties` | ~1630–1648 | `manager.Delete2(key)` |

Each is guarded by `string.IsNullOrWhiteSpace(kvp.Value)` and each counts the delete as a successful
write. The stated reason, in the comments, is:

> `SetCustomProperty("", ...)` is unreliable and reads drop empty values, so the old value would
> otherwise survive and "bounce back".

That reason has two halves and both have moved.

The **bounce back** half was a BluePLM problem, not a SolidWorks one: roughly thirty read sites each
decided for themselves how to combine a pending edit with the server's value, and three of the five
patterns could not tell "the user cleared this" from "the user has not touched this", so they fell
back to the value just deleted. Commit `098c64b` replaced all of them with one resolver whose rule is
presence, not truthiness. A cleared field now reads as cleared whatever the file says, so deleting
the property is no longer what makes the clear stick.

The **reads drop empty values** half is still true, and it is still in this service — see the read
change below.

## What must change

### 1. Write the empty value

In all four paths, an empty incoming value must write an empty property rather than delete one, using
the same set-then-add sequence as any other value:

- **Document Manager**: `SetCustomProperty(key, "")` first; if that throws, `AddCustomProperty(key,
  swDmCustomInfoText, "")`. If the property does not exist and `AddCustomProperty` refuses an empty
  value, creating it with a single space and then setting it to empty is acceptable; creating nothing
  is not, and must be reported as a failed write for that property rather than counted as set.
- **SolidWorks COM**: `Set2(key, "")`, falling back to `Add3(key, swCustomInfoText, "", …)`, honouring
  the result codes the same way the non-empty path now does. `Delete2` stops being reachable from a
  property write.

The comment's claim that `SetCustomProperty("", ...)` is "unreliable" should be settled empirically
rather than assumed, because the whole change rests on it. If it turns out an empty value genuinely
cannot be written through Document Manager for a property that does not yet exist, say so and the
decision gets revisited — do not fall back to deleting silently, which is the failure mode this
replaces.

### 2. Stop the read dropping empty values

`DocumentManagerAPI.ReadProperties` skips any property whose value is empty:
`if (!string.IsNullOrEmpty(value))` at roughly lines 1091 and 1237, plus the two `GetCustomProperty`
and `GetCustomProperty2` guards at 875 and 888. `SolidWorksAPI.ReadCustomProperties` should be checked
for the same pattern.

Those guards must keep the property with its empty value. Without this the service can write an empty
property and then report the file as not having it, which means:

- BluePLM's read-after-write verification cannot tell "written empty" from "deleted" or from "the
  write did not happen". It currently verifies a cleared field by value and accepts either shape,
  precisely because it cannot see the difference.
- The divergence scan cannot distinguish a file whose property is empty from one that never had it.

This is required for verification to mean anything about a clear. It is not required for the title
block, which reads the file directly.

### 3. Keep delete expressible, but make callers say it

After the change, nothing in the TypeScript app can delete a property, because the magic value was
the only way to ask. Nothing needs to today — see the audit below — so this is about not painting the
service into a corner:

- Add a distinct command, `deleteProperties`, taking `filePath`, a list of property names and an
  optional `configuration`, reaching `DeleteCustomProperty` / `Delete2` directly.
- Do **not** keep a sentinel value as a second way to spell it. A caller that means delete should
  have to name the command; the entire problem with the current convention is that a caller meaning
  "empty" and a caller meaning "gone" write the same request.
- Report per-property outcomes as the write path now does, including "the property was not there",
  which is a no-op rather than a failure.

Until a caller exists, adding this command is optional. Removing the empty-delete path is not.

### 4. Version and report

Bump the service version and add a line to `src/lib/swServiceVersion.ts` describing the behaviour
change, since a BluePLM build that clears fields against an older service silently deletes properties
instead of emptying them, and the version is the only way to tell.

## Who depends on the current convention

Audited every caller of `setProperties`, `setPropertiesBatch` and `setDocumentProperties`:

| Caller | Sends empty values? | Effect of the change |
|---|---|---|
| `src/lib/metadata/writeMetadataToFile.ts` (details panel, configuration editors, check-in) | Yes, deliberately | This is the change's whole purpose. Clears become empty properties. |
| `src/lib/commands/handlers/syncMetadata.ts` — `pushPartAssemblyMetadata` | No; every property is behind a truthiness guard | None. |
| `src/lib/commands/handlers/syncMetadata.ts` — drawing push | No; same guards, and returns early when nothing is truthy | None. |
| `src/features/integrations/solidworks/SolidWorksPanel.tsx` — "Write to file" | No; same guards | None. |

**Nothing relies on empty-means-delete to remove a property.** No caller passes an empty value in
order to delete, and there is no other delete path in `src/electron.d.ts` to migrate. The convention
is load-bearing for exactly one caller, and that caller wants the opposite of what it does.

Worth noting rather than fixing here: the three callers that filter empties by truthiness now do so
for no reason, and it costs them. `pushPartAssemblyMetadata` omits `Tab Number` for a configuration
whose tab is empty, so "Sync Metadata" leaves a stale tab in the file where the user cleared one.
That is the same divergence in a different command, and it should be moved onto
`buildMetadataWritePlan` rather than patched.

## What happens until this lands

The TypeScript side implements the decision: a cleared field produces a write of an empty value,
`buildMetadataWritePlan` emits the property rather than omitting it, and `DetailsPanel` no longer
returns early when every field is empty, so a full clear reaches the service.

The service then deletes the property. The consequences, in order of how much they matter:

- **The value is right, the shape is wrong.** The file no longer holds the old value, which is the
  divergence that mattered. What it holds instead is nothing rather than an empty property.
- **`$PRP:` references are still exposed.** The reason for the decision is not yet served. A drawing
  whose title block references a property the user clears can still break, exactly as before.
- **A clear verifies as `verified`.** `verifyWrite` normalizes both "" and a missing key to `null`, so
  a cleared field reads as satisfied whether the property is empty or absent. This is deliberate: by
  value it is correct, the value is what the app reads next time, and marking every clear as failed
  would train users to ignore the mark. Once the service change lands, a clear that reads back absent
  is still verified — what changes is that it stops happening.

**End-to-end testing of the decision is therefore not possible right now**, and no workaround was
built for it. What is tested, in isolation: that the plan emits an empty property rather than omitting
it (`writePlan.test.ts`), that the write path sends it unfiltered (`writeMetadataToFile.test.ts`),
that check-in sends it too (`checkinMetadata.test.ts`), and that verification accepts both shapes
(`verifyWrite.test.ts`). The one assertion that cannot be written is that the property survives in
the document, because today it does not.
