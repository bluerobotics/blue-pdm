/**
 * Deciding whether a metadata write actually landed, by reading the file back and looking.
 *
 * The plan's read-after-write verification existed only in the diagnostic probe: `scan-divergence`
 * read documents and compared them against rows, and the production write path took the service's
 * "success" at its word. That word is weaker than it sounds. The service reports the outcome of the
 * API call, not the state of the file - a property whose info type SolidWorks will not accept, a
 * configuration that silently declines the value, a save that does not reach disk - and every one
 * of those returns success.
 *
 * So a write is not confirmed until the value has been read out of the file again. This module is
 * the comparison half of that, kept pure so the rule can be tested without SolidWorks: the caller
 * supplies what it asked for and what the document now says, and gets back a state per address.
 *
 * ## Reading the intent
 *
 * The comparison is by value, under the same read priority the rest of the app uses - `divergence.ts`
 * owns those key lists and this module borrows them rather than restating them, so a document whose
 * part number lives in `Base Item Number` verifies here exactly as it reads everywhere else. It
 * borrows the scope definition from there too: a configuration holds what its own property bag
 * holds, with nothing showing through from the document underneath. See `scopeProperties`.
 *
 * An intended empty value is the interesting case. `normalizeValue` maps both "" and a missing key
 * to `null`, so a cleared field verifies whether the property is present-and-empty or absent
 * altogether. That is deliberate. The product decision is that clearing writes an empty property
 * and leaves it in the file, because a `$PRP:` title-block reference renders blank against an
 * empty property and can break against a missing one, and since service 1.19.0 the write paths do
 * that rather than deleting. Accepting absence as well is what keeps this module right about a
 * file written by an older service, or by SolidWorks itself, where the property is simply gone.
 * The answer is the same either way only because the read is scoped: a cleared configuration
 * description reads as absent from that configuration whether the property was deleted or written
 * empty, and a file-level `Description` that the user still wants showing through is not mistaken
 * for a survivor.
 *
 * Pure: no I/O, no store access, no React.
 */

import {
  CONFIG_SCOPE_SPECS,
  FILE_SCOPE_SPECS,
  configurationScopeProperties,
  isPropertyReference,
  normalizeValue,
  type FileMetadata,
  type FieldSpec,
} from './divergence'
import type {
  MetadataConfigField,
  MetadataScalarField,
  MetadataWriteAddress,
  MetadataWriteState,
} from './writeState'

/** Read priority for a file-scope tab number, which `divergence.ts` has no file-scope spec for. */
const TAB_NUMBER_KEYS = ['Tab Number', 'TabNumber', 'Tab No', 'Tab', 'TAB', 'Suffix'] as const

const FILE_SPECS: Record<MetadataScalarField, Pick<FieldSpec, 'readKeys' | 'acceptKeys'>> = {
  part_number: mustFind(FILE_SCOPE_SPECS, 'part_number'),
  description: mustFind(FILE_SCOPE_SPECS, 'description'),
  revision: mustFind(FILE_SCOPE_SPECS, 'revision'),
  tab_number: { readKeys: TAB_NUMBER_KEYS, acceptKeys: TAB_NUMBER_KEYS },
}

const CONFIG_SPECS: Record<MetadataConfigField, Pick<FieldSpec, 'readKeys' | 'acceptKeys'>> = {
  config_tab: mustFind(CONFIG_SCOPE_SPECS, 'config_tab'),
  config_description: mustFind(CONFIG_SCOPE_SPECS, 'config_description'),
}

function mustFind(
  specs: readonly FieldSpec[],
  field: string,
): Pick<FieldSpec, 'readKeys' | 'acceptKeys'> {
  const spec = specs.find((s) => s.field === field)
  if (!spec) throw new Error(`No divergence field spec for ${field}`)
  return { readKeys: spec.readKeys, acceptKeys: spec.acceptKeys }
}

/** Where a value was actually written, when that is not where its address lives. */
export type VerifyScope = 'file' | { configuration: string }

/** One value the write asked the file to hold. */
export interface MetadataWriteIntent {
  address: MetadataWriteAddress
  /** What the user asked for. An empty string is a deliberate clear, not an absence. */
  expected: string
  /**
   * The scope to read the value back from, when it differs from the address.
   *
   * A multi-configuration file takes its file-scope fields - part number, revision, the file-level
   * description - into the active configuration's property bag rather than the document's, because
   * that is where SolidWorks resolves them from for that configuration. The state still belongs to
   * the file-scope field, so the address and the place to look come apart, and pretending they do
   * not would fail every base-metadata write on a multi-configuration part.
   */
  verifyIn?: VerifyScope
}

/** One address's verdict, ready to be recorded against the file. */
export interface VerifiedAddress {
  address: MetadataWriteAddress
  state: MetadataWriteState
  reason?: string
}

/**
 * Every value the file carries under a key set, skipping property references.
 *
 * A `$PRP:`-shaped value is a formula that renders as something else, so counting it as agreement
 * would verify a write against a reference to itself.
 */
function acceptedValues(
  properties: Readonly<Record<string, string>>,
  keys: readonly string[],
): string[] {
  const values: string[] = []
  for (const key of keys) {
    const raw = properties[key]
    if (raw === undefined || isPropertyReference(raw)) continue
    const normalized = normalizeValue(raw)
    if (normalized !== null) values.push(normalized)
  }
  return values
}

/**
 * The properties a write is judged against: the bag it was written to, and only that bag.
 *
 * This used to spread `fileProperties` underneath a configuration's bag, on the argument that the
 * configuration loader reads them that way and so the resolved value a user sees would be right.
 * The resolved value is a different question from whether the write landed, and conflating them
 * broke verification in both directions.
 *
 * A file-scope field on a multi-configuration document is written *into* a configuration's bag - see
 * `MetadataWriteIntent.verifyIn` - so a stale file-level `Base Item Number` left over from an
 * earlier release would satisfy an intent whose configuration write had written nothing at all. That
 * reported `verified`, the one state a retry skips and check-in forgets, while the configuration's
 * composite `Number` was never set and the title block was wrong. In the other direction, clearing
 * one configuration's description on a document that also has a file-level `Description` read the
 * file-level value as a survivor and reported `failed` forever: every check-in re-issued the write,
 * paid for the read-back, failed again and promoted the value unconfirmed.
 *
 * `divergence.ts` owns the definition and the scanner uses the same one, so the two can no longer
 * disagree about what a configuration holds. `resolvedConfigurationProperties` is the display view
 * and lives beside it, named apart.
 */
function scopeProperties(file: FileMetadata, scope: VerifyScope): Readonly<Record<string, string>> {
  if (scope === 'file') return file.fileProperties
  return configurationScopeProperties(file, scope.configuration)
}

/** Where an intent's value should be read from: its own instruction, else its address. */
function verifyScopeOf(intent: MetadataWriteIntent): VerifyScope {
  if (intent.verifyIn) return intent.verifyIn
  return intent.address.scope === 'file'
    ? 'file'
    : { configuration: intent.address.configuration }
}

function specFor(address: MetadataWriteAddress): Pick<FieldSpec, 'readKeys' | 'acceptKeys'> {
  return address.scope === 'file' ? FILE_SPECS[address.field] : CONFIG_SPECS[address.field]
}

/**
 * Whether the document now holds what one intent asked for.
 *
 * Exact after trimming: a part number differing in case or spacing is a different part number, not
 * noise. An intended clear is satisfied by the file having no readable value, which is the one
 * comparison where absence counts as agreement.
 */
export function verifyIntent(
  intent: MetadataWriteIntent,
  file: FileMetadata,
): { verified: boolean; found: string | null } {
  const expected = normalizeValue(intent.expected)
  const properties = scopeProperties(file, verifyScopeOf(intent))
  const spec = specFor(intent.address)
  const accepted = acceptedValues(properties, spec.acceptKeys)

  if (expected === null) {
    return { verified: accepted.length === 0, found: accepted[0] ?? null }
  }

  return { verified: accepted.includes(expected), found: accepted[0] ?? null }
}

/**
 * Turn a read-back into a verdict per address.
 *
 * A configuration the document does not have cannot hold the value, and saying so by name is the
 * point: this is how "`AS568-014` refused the tab number and the other 67 took it" is expressed,
 * rather than one rounded-off answer for the file.
 */
export function verifyWrite(
  intents: readonly MetadataWriteIntent[],
  file: FileMetadata,
): VerifiedAddress[] {
  return intents.map((intent) => {
    const scope = verifyScopeOf(intent)
    if (scope !== 'file' && !file.configurations.includes(scope.configuration)) {
      return {
        address: intent.address,
        state: 'failed' as const,
        reason: `the file has no configuration named ${scope.configuration}`,
      }
    }

    const { verified, found } = verifyIntent(intent, file)
    if (verified) return { address: intent.address, state: 'verified' as const }

    return {
      address: intent.address,
      state: 'failed' as const,
      reason:
        found === null
          ? 'the file has no value for this field after the write'
          : `the file holds "${found}" after the write`,
    }
  })
}

/**
 * The verdict when the write was issued but the file could not be read back.
 *
 * Distinct from `failed` on purpose. `failed` means the value is known not to be in the file, so a
 * retry is the whole remedy; this means nobody knows, and a retry may be writing over a value that
 * is already correct. Recording it as either of the other two is the bug this phase exists to fix.
 */
export function unverifiedWrite(
  intents: readonly MetadataWriteIntent[],
  reason: string,
): VerifiedAddress[] {
  return intents.map((intent) => ({ address: intent.address, state: 'unverified', reason }))
}

/** The verdict when the service reported the write itself as failed. */
export function failedWrite(
  intents: readonly MetadataWriteIntent[],
  reason: string,
): VerifiedAddress[] {
  return intents.map((intent) => ({ address: intent.address, state: 'failed', reason }))
}

/**
 * The verdict when no write was issued for these intents at all.
 *
 * `failed` would be a claim about the document that nobody made; `unattempted` says the file was
 * never touched, which is the whole reason the two states are separate. It still owes the file a
 * write, so a retry picks it up.
 */
export function unattemptedWrite(
  intents: readonly MetadataWriteIntent[],
  reason: string,
): VerifiedAddress[] {
  return intents.map((intent) => ({ address: intent.address, state: 'unattempted', reason }))
}
