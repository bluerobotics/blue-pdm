import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ErrorCode, sendError } from './errors.js'

const API_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Directories that hold no source: dependencies, build output, and the emitted tree. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage'])

/**
 * The files allowed to build a reply without `sendError`, and why each one is not a
 * bypass of the convention. A file earns a place here by not being the API's own
 * error, not by being inconvenient to change.
 */
const ALLOWED_INLINE_ERROR_REPLIES: Readonly<Record<string, string>> = {
  'utils/errors.ts': 'is sendError',
  'src/core/plugins/errorHandler.ts':
    'is the other half of the same contract - it turns a thrown error into a reply, ' +
    'and its 5xx branch deliberately withholds the message and substitutes the request id',
  'src/extensions/router.ts':
    "forwards an extension handler's own response verbatim, status and body alike. The " +
    'status is not a literal because the extension chose it; the body is the extension ' +
    "contract, not the API's, and no API internals reach it. The router's own failures " +
    'do go through sendError.',
}

const LOWEST_ERROR_STATUS = 400

/** `reply.code(400).send(` and `reply.status(400).send(`, tolerating line breaks. */
const REPLY_SEND_PATTERN = /reply\s*\.\s*(?:code|status)\s*\(\s*([^)]*?)\s*\)\s*\.\s*send\s*\(/g

interface ReplySend {
  file: string
  line: number
  status: string
}

function collectTypeScriptFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)

    if (statSync(path).isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry)) collectTypeScriptFiles(path, found)
      continue
    }

    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) found.push(path)
  }

  return found
}

function collectReplySends(): { files: number; sends: ReplySend[] } {
  const files = collectTypeScriptFiles(API_ROOT)
  const sends: ReplySend[] = []

  for (const path of files) {
    const source = readFileSync(path, 'utf8')

    for (const match of source.matchAll(REPLY_SEND_PATTERN)) {
      sends.push({
        file: relative(API_ROOT, path).split(sep).join('/'),
        line: source.slice(0, match.index).split('\n').length,
        status: match[1],
      })
    }
  }

  return { files: files.length, sends }
}

/**
 * A status that is provably not an error. Anything non-literal counts as an error
 * reply: a computed status is exactly the shape that carried the stack-trace
 * disclosure, and it cannot be cleared by reading the call site alone.
 */
function isSuccessStatus(status: string): boolean {
  return /^\d+$/.test(status) && Number(status) < LOWEST_ERROR_STATUS
}

describe('sendError', () => {
  it('omits the message key entirely when there is no message', () => {
    const sent: unknown[] = []
    const reply = { status: () => reply, send: (body: unknown) => sent.push(body) }

    sendError(reply as never, 404, ErrorCode.NOT_FOUND)

    expect(sent).toEqual([{ error: 'NOT_FOUND' }])
  })

  it('carries the message when one is given', () => {
    const sent: unknown[] = []
    const reply = { status: () => reply, send: (body: unknown) => sent.push(body) }

    sendError(reply as never, 403, ErrorCode.FORBIDDEN, 'Not a member of this organization')

    expect(sent).toEqual([
      { error: 'FORBIDDEN', message: 'Not a member of this organization' },
    ])
  })

  it('uses SCREAMING_SNAKE for every code', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(code, code).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  })
})

/**
 * `255a2e4` fixed the one route that returned a stack trace to an unauthenticated
 * caller. The convention that would have prevented it - every error reply goes through
 * `sendError`, so the body shape and the disclosure decision live in one place - was
 * left as prose in `.cursor/rules/style.mdc`, where nothing enforces it.
 *
 * This is that convention as an assertion. It is a source scan rather than a runtime
 * check because the property is about how a reply is *written*: a route that formats
 * its own error body is a defect whether or not any test happens to reach it.
 */
describe('error replies go through sendError', () => {
  const { files, sends } = collectReplySends()

  it('scanned the api source tree', () => {
    // A sweep that finds nothing proves nothing unless it also proves it looked. Both
    // numbers are lower bounds well under what the tree holds today, so ordinary
    // growth does not touch them and a scan pointed at an empty directory fails here
    // rather than passing the assertion below for the wrong reason.
    expect(files).toBeGreaterThan(50)
    expect(sends.length).toBeGreaterThan(0)
  })

  it('builds no error reply inline', () => {
    const violations = sends.filter(
      (send) =>
        !isSuccessStatus(send.status) && !(send.file in ALLOWED_INLINE_ERROR_REPLIES),
    )

    expect(
      violations.map((send) => `${send.file}:${send.line} reply.code(${send.status}).send(`),
    ).toEqual([])
  })

  it('carries no allow-list entry that has stopped being needed', () => {
    // An entry whose file no longer builds a reply inline is a standing permission
    // nobody is watching. Removing it is how the list shrinks instead of accreting.
    const filesThatStillNeedIt = new Set(
      sends.filter((send) => !isSuccessStatus(send.status)).map((send) => send.file),
    )

    for (const file of Object.keys(ALLOWED_INLINE_ERROR_REPLIES)) {
      expect(filesThatStillNeedIt, `${file} no longer needs its allow-list entry`).toContain(
        file,
      )
    }
  })
})
