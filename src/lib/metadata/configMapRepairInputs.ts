/**
 * Parsing the two inputs the configuration-map repair plans from.
 *
 * Both are artifacts of things that already ran: the read-only shape query against `files`, and the
 * Document Manager census of the vault. The repair re-reads neither the database nor the vault, so
 * these parsers are the whole of its input surface, and keeping them pure is what lets the plan be
 * tested against literal fixtures rather than against a machine.
 *
 * Tolerant on purpose, in one direction only. Column names arrive as the SQL wrote them, arrays may
 * be absent or null, and the shape column may be missing entirely, in which case it is inferred
 * from whether the key list is an array. What is *not* tolerated is a row whose shape cannot be
 * established: it is rejected rather than defaulted, because defaulting a missing map to `present`
 * would let a fill run against a row that never held the map.
 *
 * This module is pure: it takes strings and returns data. No file system, no network, no store.
 */

import { CONFIG_DESCRIPTIONS_KEY, CONFIG_TABS_KEY } from './divergence'

import type { CensusDocument, ConfigMapShapeRow, MapShape } from './configMapRepair'

// ============================================
// JSON shims
// ============================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.filter((entry): entry is string => typeof entry === 'string')
}

/** A property bag as Document Manager reports it: string to string, anything else dropped. */
function propertyBag(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const bag: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') bag[key] = raw
    else if (typeof raw === 'number') bag[key] = String(raw)
  }
  return bag
}

/**
 * Parse a document that is either a JSON array, an object wrapping one, or NDJSON.
 *
 * The SQL editor exports an array, `json_agg` in a single cell exports an array, and the census
 * writes one object per line. Accepting all three removes a conversion step from the operator,
 * which is a step at which the wrong file gets passed.
 */
export function parseJsonDocuments(text: string): unknown[] {
  const trimmed = text.trim()
  if (trimmed.length === 0) return []

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed
      if (isRecord(parsed)) {
        for (const key of ['rows', 'data', 'result']) {
          const nested = parsed[key]
          if (Array.isArray(nested)) return nested
        }
        return [parsed]
      }
    } catch {
      // Falls through to NDJSON, which is what a file of one JSON object per line looks like to
      // `JSON.parse` after the first line.
    }
  }

  const documents: unknown[] = []
  for (const line of trimmed.split(/\r?\n/)) {
    const candidate = line.trim()
    if (candidate.length === 0) continue
    documents.push(JSON.parse(candidate) as unknown)
  }
  return documents
}

// ============================================
// The database shape export
// ============================================

/** Postgres writes `present-EMPTY`; the type spells it lower case. */
function toMapShape(value: unknown): MapShape | null {
  if (typeof value !== 'string') return null
  switch (value.trim().toLowerCase()) {
    case 'absent':
      return 'absent'
    case 'present':
      return 'present'
    case 'present-empty':
      return 'present-empty'
    case 'not-an-object':
      return 'not-an-object'
    default:
      return null
  }
}

/**
 * Establish one map's shape and key list.
 *
 * When the shape column is absent it is inferred from the key list, which the query returns as
 * `NULL` for a map that is not an object and as an array otherwise. An inference that cannot be
 * made returns null and rejects the row, rather than guessing at `absent` - the two wrong guesses
 * are "skip a repairable row" and "fill a row that never held the map", and only one of those is
 * recoverable.
 */
function readMap(
  record: Record<string, unknown>,
  shapeKey: string,
  keysKey: string,
): { shape: MapShape; keys: string[] } | null {
  const keys = stringArray(record[keysKey])
  const declared = toMapShape(record[shapeKey])

  if (declared !== null) return { shape: declared, keys: keys ?? [] }
  if (!(keysKey in record)) return null
  if (keys === null) return { shape: 'absent', keys: [] }
  return { shape: keys.length === 0 ? 'present-empty' : 'present', keys }
}

export interface ShapeParseResult {
  rows: ConfigMapShapeRow[]
  /** Records that carried no usable shape for either map, with the reason. */
  rejected: { record: unknown; reason: string }[]
}

/**
 * Read the output of the read-only shape query.
 *
 * Expected per record, matching the column names the query selects:
 *
 * ```
 * id                          uuid, optional - required only to emit SQL
 * file_path                   text
 * file_name                   text
 * tab_map_shape               'absent' | 'present' | 'present-EMPTY' | 'not-an-object'
 * tab_configurations          text[] or null
 * description_map_shape       same
 * description_configurations  text[] or null
 * updated_at                  timestamptz, optional
 * ```
 */
export function parseShapeRows(text: string): ShapeParseResult {
  const rows: ConfigMapShapeRow[] = []
  const rejected: { record: unknown; reason: string }[] = []

  for (const record of parseJsonDocuments(text)) {
    if (!isRecord(record)) {
      rejected.push({ record, reason: 'not a JSON object' })
      continue
    }

    const filePath = stringOrNull(record.file_path) ?? stringOrNull(record.filePath)
    if (filePath === null) {
      rejected.push({ record, reason: 'no file_path' })
      continue
    }

    const tabs = readMap(record, 'tab_map_shape', 'tab_configurations')
    const descriptions = readMap(record, 'description_map_shape', 'description_configurations')
    if (!tabs || !descriptions) {
      rejected.push({ record, reason: `no map shape for ${filePath}` })
      continue
    }

    const fileName = stringOrNull(record.file_name) ?? filePath.split('\\').pop() ?? filePath

    rows.push({
      id: stringOrNull(record.id),
      filePath,
      fileName,
      shapes: {
        [CONFIG_TABS_KEY]: tabs.shape,
        [CONFIG_DESCRIPTIONS_KEY]: descriptions.shape,
      },
      keys: {
        [CONFIG_TABS_KEY]: tabs.keys,
        [CONFIG_DESCRIPTIONS_KEY]: descriptions.keys,
      },
      updatedAt: stringOrNull(record.updated_at),
    })
  }

  return { rows, rejected }
}

// ============================================
// The Document Manager census
// ============================================

/** Lower-cased, backslash-separated, leading separators stripped. The join key on both sides. */
export function censusKey(relativePath: string): string {
  return relativePath.replace(/\//g, '\\').replace(/^\\+/, '').toLowerCase()
}

/** Strip the vault root off an absolute census path. Returns null when it sits outside the vault. */
export function toRelativePath(absolutePath: string, vaultRoot: string): string | null {
  const path = absolutePath.replace(/\//g, '\\')
  const root = vaultRoot.replace(/\//g, '\\').replace(/\\+$/, '')
  const prefix = `${root}\\`
  if (!path.toLowerCase().startsWith(prefix.toLowerCase())) return null
  return path.slice(prefix.length)
}

export interface CensusIndex {
  /** Readable documents, keyed by `censusKey` of their relative path. */
  documents: Map<string, CensusDocument>
  /** Documents the census could not read, keyed the same way, valued by the status it recorded. */
  unreadable: Map<string, string>
  /** Records whose path fell outside the vault root, so no row could refer to them. */
  outsideVault: number
}

/**
 * Index the census NDJSON, as `DmRead.ps1` writes it.
 *
 * A record whose `Status` is anything other than `ok` goes to `unreadable`, including
 * `held-by-another-process` - the status a document open in the running SOLIDWORKS produces. That
 * distinction matters to the operator: a file skipped because it was open is a file whose repair is
 * merely deferred, not a file with nothing to recover.
 */
export function indexCensus(text: string, vaultRoot: string): CensusIndex {
  const documents = new Map<string, CensusDocument>()
  const unreadable = new Map<string, string>()
  let outsideVault = 0

  for (const record of parseJsonDocuments(text)) {
    if (!isRecord(record)) continue

    const absolutePath = stringOrNull(record.Path) ?? stringOrNull(record.path)
    if (absolutePath === null) continue

    const relativePath = toRelativePath(absolutePath, vaultRoot)
    if (relativePath === null) {
      outsideVault += 1
      continue
    }

    const key = censusKey(relativePath)
    const status = stringOrNull(record.Status) ?? stringOrNull(record.status) ?? 'unknown'

    if (status !== 'ok') {
      unreadable.set(key, status)
      continue
    }

    const configurationProperties: Record<string, Record<string, string>> = {}
    const rawConfigProps = record.ConfigProps ?? record.configProps
    if (isRecord(rawConfigProps)) {
      for (const [name, bag] of Object.entries(rawConfigProps)) {
        configurationProperties[name] = propertyBag(bag)
      }
    }

    const declared = stringArray(record.Configurations ?? record.configurations)
    const configurations =
      declared && declared.length > 0 ? declared : Object.keys(configurationProperties)

    documents.set(key, {
      relativePath,
      absolutePath,
      configurations,
      fileProperties: propertyBag(record.FileProps ?? record.fileProps),
      configurationProperties,
    })
  }

  return { documents, unreadable, outsideVault }
}
