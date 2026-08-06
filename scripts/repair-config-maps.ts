#!/usr/bin/env node
/**
 * Entry point for the configuration-map repair (`npm run repair:config-maps`).
 *
 * Fills the per-configuration entries the pre-fix `checkin_file` erased from
 * `files.custom_properties._config_tabs` and `._config_descriptions`, reading the values back out
 * of the SolidWorks documents, which is where they survived.
 *
 * ## What this process can and cannot do
 *
 * It reads two files and writes at most one. There is no database client anywhere in its import
 * graph - it cannot connect to Supabase, so it cannot apply anything; the most it produces is a
 * `.sql` file for the database owner to run, and only when `--emit-sql` names a path. It does not
 * open the vault either: the document side comes from the Document Manager census NDJSON that
 * `DmRead.ps1` already produced with `readOnly: true`, so nothing here can disturb the SOLIDWORKS
 * session the operator has open.
 *
 * A standalone script rather than a terminal command in `src/lib/commands/handlers/` for exactly
 * those two reasons. A command runs inside the app, which holds an authenticated, write-capable
 * Supabase session and reaches the vault through `solidworks.getProperties` - a dispatch that
 * consults `IsFileOpenInSolidWorks` and can therefore read through the live session. Both are
 * things this work is required not to have. The planning, SQL and reporting logic all live in
 * `src/lib/metadata/`, where it is typechecked and unit-tested; this file is argument parsing and
 * file I/O.
 *
 * Usage:
 *   npm run repair:config-maps -- --shapes=<file> --census=<file>
 *   npm run repair:config-maps -- --shapes=... --census=... --path="0 - SHARED\01-TOOLBOX"
 *   npm run repair:config-maps -- --shapes=... --census=... --emit-sql=repair.sql
 *
 * Flags:
 *   --shapes=<file>              output of tools/config-map-repair/export-config-map-shapes.sql
 *   --census=<file>              the Document Manager census NDJSON (vault-out.jsonl)
 *   --vault=<path>               vault root, for turning census paths into row paths
 *   --path=<prefix>              only plan rows under this relative path
 *   --only=<a;b>                 only plan these exact relative paths, semicolon separated
 *   --include-derived            also fill tabs derived from the configuration's Number
 *   --skip-file-level-duplicates leave out values equal to the document's file-level value
 *   --emit-sql=<file>            write the SQL. Without this flag nothing is written at all.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  DEFAULT_REPAIR_OPTIONS,
  planConfigMapRepair,
  type RepairOptions,
} from '../src/lib/metadata/configMapRepair.ts'
import { indexCensus, parseShapeRows } from '../src/lib/metadata/configMapRepairInputs.ts'
import { formatRepairPlan } from '../src/lib/metadata/configMapRepairReport.ts'
import { emitRepairSql } from '../src/lib/metadata/configMapRepairSql.ts'

const DEFAULT_VAULT_ROOT = 'C:\\BluePLM\\br-vault'

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const found = process.argv.slice(2).find((argument) => argument.startsWith(prefix))
  return found ? found.slice(prefix.length) : undefined
}

function switched(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`)
}

/** Strip a byte-order mark, which a file saved out of the SQL editor may well carry. */
function read(path: string): string {
  const text = readFileSync(path, 'utf8')
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function requireFile(name: string): string {
  const path = flag(name)
  if (!path) fail(`Missing --${name}=<file>. See the header of scripts/repair-config-maps.ts.`)
  if (!existsSync(path)) fail(`No such file: ${path}`)
  return path
}

/**
 * Refuse to write anywhere inside the vault.
 *
 * The vault is the evidence this repair reads from and the thing it promises not to touch. Dropping
 * a generated artifact into it would break that promise for no benefit, and it is the kind of
 * mistake a relative path makes easy.
 */
function assertOutsideVault(outputPath: string, vaultRoot: string): void {
  const target = resolve(outputPath).toLowerCase()
  const root = resolve(vaultRoot).toLowerCase()
  if (target === root || target.startsWith(`${root}\\`) || target.startsWith(`${root}/`)) {
    fail(`Refusing to write inside the vault: ${outputPath}`)
  }
}

function main(): void {
  const shapesPath = requireFile('shapes')
  const censusPath = requireFile('census')
  const vaultRoot = flag('vault') ?? DEFAULT_VAULT_ROOT

  const options: RepairOptions = {
    ...DEFAULT_REPAIR_OPTIONS,
    includeDerivedTabs: switched('include-derived'),
    skipFileLevelDuplicates: switched('skip-file-level-duplicates'),
    pathPrefix: flag('path'),
    onlyPaths: flag('only')?.split(';').filter(Boolean),
  }

  const shapes = parseShapeRows(read(shapesPath))
  const census = indexCensus(read(censusPath), vaultRoot)

  console.log(
    `Shape export: ${shapes.rows.length} rows` +
      (shapes.rejected.length > 0 ? `, ${shapes.rejected.length} rejected` : ''),
  )
  for (const rejection of shapes.rejected.slice(0, 10)) console.log(`  rejected: ${rejection.reason}`)
  console.log(
    `Census: ${census.documents.size} documents read, ${census.unreadable.size} not read` +
      (census.outsideVault > 0 ? `, ${census.outsideVault} outside ${vaultRoot}` : ''),
  )
  console.log('')

  const plan = planConfigMapRepair(shapes.rows, census.documents, census.unreadable, options)
  for (const line of formatRepairPlan(plan)) console.log(line)

  const sqlPath = flag('emit-sql')
  console.log('')

  if (!sqlPath) {
    console.log('Dry run. No file was written and no database was contacted.')
    console.log('Pass --emit-sql=<file> to write the SQL for the database owner to run.')
    return
  }

  assertOutsideVault(sqlPath, vaultRoot)

  const emitted = emitRepairSql(plan, new Date().toISOString())
  writeFileSync(sqlPath, emitted.sql, 'utf8')

  console.log(`Wrote ${emitted.statements} UPDATE statements to ${sqlPath}`)
  console.log('Nothing has been applied. The database owner runs that file in the SQL editor.')
  for (const omission of emitted.omitted) {
    console.log(`  omitted ${omission.relativePath}: ${omission.reason}`)
  }
}

main()
