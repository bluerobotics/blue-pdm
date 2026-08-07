/**
 * Calling the configuration-map repair, and nothing else.
 *
 * This module is the only thing in the application that can change a reserved per-configuration
 * map, and all it does is hand an approved set to `repair_config_maps` and translate the receipt.
 * It performs no merge of its own: the merge is `computed || existing` inside the database
 * function, where the row is on the right and the key set can only grow, so there is no argument
 * this module could construct that would overwrite or delete an entry.
 *
 * ## The function may not be installed
 *
 * It arrives in schema 94 and production has been running 85 - which is also the release the wipe
 * this repairs is still live in. A caller that hits an older database gets SQLSTATE 42883, and
 * that is reported as "not installed yet" rather than as a failure, because it is a fact about the
 * database rather than about the request. Saying so plainly is the difference between an
 * administrator applying the schema and an administrator filing a bug.
 */

import { getSupabaseClient } from '@/lib/supabase/client'
import { log } from '@/lib/logger'
import { CONFIG_DESCRIPTIONS_KEY, CONFIG_TABS_KEY } from '@/lib/metadata/divergence'
import type { ConfigMapKey } from '@/lib/metadata/configMapRepair'
import type {
  VaultAuditRepairFile,
  VaultAuditRepairFileOutcome,
  VaultAuditRepairOutcome,
} from '@/types/vaultAudit'

/** PostgreSQL's `undefined_function`. What an older database answers for an RPC it has never had. */
const UNDEFINED_FUNCTION = '42883'

/** Raised when the database predates schema 94. Carries no blame for the request. */
export class ConfigMapRepairNotInstalledError extends Error {
  constructor() {
    super('repair_config_maps is not installed')
    this.name = 'ConfigMapRepairNotInstalledError'
  }
}

const RESERVED_MAPS: readonly ConfigMapKey[] = [CONFIG_TABS_KEY, CONFIG_DESCRIPTIONS_KEY]

/**
 * The client Supabase's generated types do not know about.
 *
 * `src/types/supabase.ts` is generated from the deployed schema, and a function staged for the
 * next release is not in it. Narrowed to the one call rather than casting the whole client to
 * `any`, so the argument and return shapes are still checked at every call site.
 */
interface RepairRpcClient {
  rpc: (
    name: 'repair_config_maps',
    args: { p_org_id: string; p_repairs: unknown },
  ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

/**
 * Read one file's receipt.
 *
 * Tolerant about shape and strict about meaning: an entry it cannot read reports zero added rather
 * than being dropped, because a file silently missing from the receipt would read as a file that
 * was never asked about.
 */
function readFileOutcome(raw: unknown): VaultAuditRepairFileOutcome {
  const record = isRecord(raw) ? raw : {}
  const maps = isRecord(record.maps) ? record.maps : {}

  const added: Partial<Record<ConfigMapKey, number>> = {}
  const mapsAbsent: ConfigMapKey[] = []

  for (const key of RESERVED_MAPS) {
    const report = maps[key]
    if (!isRecord(report)) continue
    if (report.refused === 'map-absent') {
      mapsAbsent.push(key)
      continue
    }
    added[key] = asNumber(report.added)
  }

  return {
    fileId: typeof record.file_id === 'string' ? record.file_id : '',
    relativePath: typeof record.file_path === 'string' ? record.file_path : null,
    updated: record.updated === true,
    refused: typeof record.refused === 'string' ? record.refused : null,
    added,
    mapsAbsent,
  }
}

function readOutcome(raw: unknown): VaultAuditRepairOutcome {
  const record = isRecord(raw) ? raw : {}
  const files = Array.isArray(record.files) ? record.files : []

  return {
    filesRequested: asNumber(record.files_requested),
    filesUpdated: asNumber(record.files_updated),
    entriesRequested: asNumber(record.entries_requested),
    entriesAdded: asNumber(record.entries_added),
    files: files.map(readFileOutcome),
  }
}

/** The wire shape `repair_config_maps` expects. Snake-cased here, at the boundary. */
function toPayload(files: readonly VaultAuditRepairFile[]): unknown[] {
  return files.map((file) => ({ file_id: file.fileId, maps: file.maps }))
}

/**
 * Apply an approved set of repairs.
 *
 * Throws `ConfigMapRepairNotInstalledError` when the database predates schema 94, and a plain
 * `Error` carrying the database's own message otherwise - including the two refusals the function
 * raises for itself, which are an authorization answer and a malformed request rather than
 * anything the caller should retry.
 */
export async function applyConfigMapRepair(
  orgId: string,
  files: readonly VaultAuditRepairFile[],
): Promise<VaultAuditRepairOutcome> {
  const client = getSupabaseClient() as unknown as RepairRpcClient

  const { data, error } = await client.rpc('repair_config_maps', {
    p_org_id: orgId,
    p_repairs: toPayload(files),
  })

  if (error) {
    if (error.code === UNDEFINED_FUNCTION) throw new ConfigMapRepairNotInstalledError()
    throw new Error(error.message)
  }

  const outcome = readOutcome(data)

  log.info('[ConfigMapRepair]', 'Repair applied', {
    filesRequested: outcome.filesRequested,
    filesUpdated: outcome.filesUpdated,
    entriesRequested: outcome.entriesRequested,
    entriesAdded: outcome.entriesAdded,
  })

  return outcome
}
