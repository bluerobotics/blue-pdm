// Emits the SQL literal for schema_release_description() from the app-side
// VERSION_DESCRIPTIONS entry, so the two cannot drift at the moment they are
// written. src/lib/__tests__/schemaReleaseDescription.test.ts keeps them from
// drifting afterwards.
//
// Usage:
//   node scripts/emit-release-description-sql.mjs            # print to stdout
//   node scripts/emit-release-description-sql.mjs --write    # patch supabase/core.sql

import { readFileSync, writeFileSync } from 'node:fs'

const WRAP_AT = 88

const source = readFileSync('src/lib/schemaVersion.ts', 'utf8')

const args = process.argv.slice(2)
const write = args.includes('--write')

const expected = source.match(/EXPECTED_SCHEMA_VERSION\s*=\s*(\d+)/)
if (!expected) {
  throw new Error('could not read EXPECTED_SCHEMA_VERSION from src/lib/schemaVersion.ts')
}

const version = Number(args.find((a) => /^\d+$/.test(a)) ?? expected[1])

const entry = source.match(new RegExp(`^\\s*${version}:\\s*'((?:[^'\\\\]|\\\\.)*)',`, 'm'))
if (!entry) {
  throw new Error(`no VERSION_DESCRIPTIONS[${version}] entry found`)
}

const text = entry[1]
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  .replace(/\\'/g, "'")
  .replace(/\u2019/g, "'")

const words = text.split(' ')
const lines = []
let line = ''
for (const word of words) {
  if (line && line.length + 1 + word.length > WRAP_AT) {
    lines.push(line)
    line = word
  } else {
    line = line ? `${line} ${word}` : word
  }
}
if (line) lines.push(line)

const literal = lines
  .map((l, i) => {
    const body = l.replace(/'/g, "''")
    const trailing = i === lines.length - 1 ? '' : ' '
    return `  '${body}${trailing}'`
  })
  .join('\n')

const rendered = `CREATE OR REPLACE FUNCTION schema_release_description() RETURNS TEXT\nLANGUAGE sql IMMUTABLE AS $$ SELECT\n${literal}\n$$;`

if (!write) {
  process.stdout.write(`${rendered}\n`)
} else {
  const core = readFileSync('supabase/core.sql', 'utf8')
  const pattern =
    /CREATE OR REPLACE FUNCTION schema_release_description\(\) RETURNS TEXT[\s\S]*?\r?\n\$\$;/
  if (!pattern.test(core)) {
    throw new Error('could not locate schema_release_description() in supabase/core.sql')
  }
  // core.sql is checked out CRLF on Windows. Splicing LF into it would leave the
  // file mixed, which shows up as a whole-file diff the next time git touches it.
  const eol = core.includes('\r\n') ? '\r\n' : '\n'
  const spliced = rendered.split('\n').join(eol)
  writeFileSync('supabase/core.sql', core.replace(pattern, () => spliced))
  process.stderr.write(`patched supabase/core.sql for release ${version}\n`)
}
