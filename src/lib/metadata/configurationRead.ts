/**
 * Reading a document's configuration list, and telling "it has none" from "we could not look".
 *
 * Every write path that plans per configuration has to ask this question first, and reading the
 * second answer as the first is finding B1: the plan degrades to the document's own property bag,
 * the read-back honestly confirms that one scope, and the user is told "confirmed in the file"
 * while all 68 configurations keep their old values.
 *
 * Three call sites used to answer it separately - `syncMetadataPush.ts`, `checkinMetadata.ts` and
 * `useConfigHandlers.ts` - which is how one of them came to be wrong while the other two were
 * right. It is answered here once.
 *
 * ## The wire contract this reads
 *
 * The service distinguishes the two cases as of service 1.20.0 (Agent D's D4). Before it, an
 * enumeration failure and a drawing both produced an empty list, and no caller could have been
 * correct. Now:
 *
 * | Outcome | Reply |
 * |---|---|
 * | Configurations read | `success: true`, `data.configurations: [...]` |
 * | Document legitimately has none (a drawing) | `success: true`, `data.configurations: []` |
 * | Enumeration failed | `success: false`, `errorCode: 'CONFIGURATION_ENUMERATION_FAILED'` |
 *
 * **An empty list on a successful reply is data, not a maybe-failure.** Refusing to write on it
 * would refuse to write to every drawing, which is the opposite mistake and just as damaging.
 */

import { log } from '@/lib/logger'

/** One configuration as the service reports it. */
export interface DocumentConfiguration {
  name: string
  isActive: boolean
  properties: Record<string, string>
}

/**
 * The list, or the reason there isn't one.
 *
 * A discriminated union rather than `string[] | null`, so that a caller cannot reach the list
 * without having said what it does about the failure first.
 */
export type ConfigurationRead =
  | { readonly ok: true; readonly configurations: readonly DocumentConfiguration[] }
  | { readonly ok: false; readonly reason: string; readonly enumerationFailed: boolean }

/**
 * `errorCode` reaches the renderer - `electron/handlers/solidworks.ts:1108` resolves the service's
 * reply object whole - but `getConfigurations`'s declaration in `src/electron.d.ts:733-747` and
 * `electron/preload.ts` omits the field, unlike the sibling commands that declare it. Both files
 * are outside this agent's boundary, so the field is narrowed here instead of being declared where
 * it belongs. Recorded as a typing-only follow-up in `C_AGENT_REPORT.md`.
 */
const ENUMERATION_FAILED = 'CONFIGURATION_ENUMERATION_FAILED'

function readErrorCode(reply: unknown): string | undefined {
  if (typeof reply !== 'object' || reply === null) return undefined
  const code = (reply as { errorCode?: unknown }).errorCode
  return typeof code === 'string' ? code : undefined
}

/**
 * Ask the service which configurations a document holds.
 *
 * Never throws: a rejected call is one more way of not knowing, and every caller has to handle not
 * knowing anyway.
 */
export async function readDocumentConfigurations(path: string): Promise<ConfigurationRead> {
  try {
    const api = window.electronAPI?.solidworks
    if (!api?.getConfigurations) {
      return {
        ok: false,
        reason: 'the SolidWorks service is not available',
        enumerationFailed: false,
      }
    }

    const reply = await api.getConfigurations(path)

    if (!reply?.success) {
      const enumerationFailed = readErrorCode(reply) === ENUMERATION_FAILED
      return {
        ok: false,
        reason:
          reply?.error ??
          (enumerationFailed
            ? 'the service could not enumerate the configurations'
            : 'the SolidWorks service returned no result'),
        enumerationFailed,
      }
    }

    // A successful reply that carries no list at all is neither of the documented outcomes, so it
    // is read as not knowing rather than as an empty document. `[]` does not land here: it is a
    // successful answer meaning the document has none, and it is passed straight through.
    const configurations = reply.data?.configurations
    if (!Array.isArray(configurations)) {
      return {
        ok: false,
        reason: 'the SolidWorks service reported success without a configuration list',
        enumerationFailed: false,
      }
    }

    return {
      ok: true,
      configurations: configurations.map((configuration) => ({
        name: configuration.name,
        isActive: configuration.isActive,
        properties: configuration.properties ?? {},
      })),
    }
  } catch (error) {
    log.warn('[ConfigurationRead]', 'Could not list the document’s configurations', { path, error })
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      enumerationFailed: false,
    }
  }
}
