/**
 * Assert & Wait Command Handlers
 *
 * Provides assertion primitives for the self-test regression framework.
 *
 * Commands:
 *   assert <path> --status=<value> --version=<n> --part=<value> ...
 *   wait <ms>
 *
 * The `assert` command inspects the Zustand store and (optionally) the
 * filesystem to verify that a file's state matches expectations. It is
 * designed to be machine-readable so the test runner can scrape PASS/FAIL
 * from terminal output.
 *
 * The `wait` command pauses execution for a given number of milliseconds,
 * useful for letting async operations settle between test steps.
 */

import { usePDMStore, LocalFile } from '../../../stores/pdmStore'
import { resolveDescription, resolvePartNumber, resolveRevision } from '@/lib/metadata/overlay'
import { registerTerminalCommand } from '../registry'
import type { ParsedCommand, TerminalOutput } from '../parser'

// ============================================
// Types
// ============================================

type OutputFn = (type: TerminalOutput['type'], content: string) => void

/**
 * Valid values for the --status flag.
 * Each maps to a specific combination of pdmData / diffStatus / checked_out_by.
 */
type StatusAssertion = 'checked-out' | 'synced' | 'cloud' | 'added' | 'deleted' | 'deleted_remote'

/**
 * Valid values for the --state flag.
 * Maps to workflow_state.name on the file's pdmData.
 */
type WorkflowStateAssertion = 'wip' | 'in_review' | 'released' | 'obsolete'

// ============================================
// Helpers
// ============================================

/**
 * Resolve a path pattern to matching files.
 *
 * Supports:
 *  - Exact match (case-insensitive)
 *  - Glob patterns (* and **)
 *  - Folder prefix matching
 *
 * Copied from info.ts to keep this module self-contained per the spec.
 */
function resolvePathPattern(pattern: string, files: LocalFile[]): LocalFile[] {
  let normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')

  if (normalizedPattern.includes('*')) {
    const regexPattern = normalizedPattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<<DOUBLESTAR>>>/g, '.*')
    const regex = new RegExp(`^${regexPattern}$`)

    return files.filter((f) => {
      const normalizedPath = f.relativePath.replace(/\\/g, '/')
      return regex.test(normalizedPath)
    })
  }

  const exactMatch = files.find(
    (f) => f.relativePath.replace(/\\/g, '/').toLowerCase() === normalizedPattern.toLowerCase(),
  )

  if (exactMatch) {
    return [exactMatch]
  }

  return files.filter((f) => {
    const normalizedPath = f.relativePath.replace(/\\/g, '/').toLowerCase()
    return normalizedPath.startsWith(normalizedPattern.toLowerCase() + '/')
  })
}

/**
 * Type-guard: check whether a string is a valid StatusAssertion.
 */
function isStatusAssertion(value: string): value is StatusAssertion {
  return ['checked-out', 'synced', 'cloud', 'added', 'deleted', 'deleted_remote'].includes(value)
}

/**
 * Type-guard: check whether a string is a valid WorkflowStateAssertion.
 */
function isWorkflowState(value: string): value is WorkflowStateAssertion {
  return ['wip', 'in_review', 'released', 'obsolete'].includes(value)
}

/**
 * Describe the actual status of a file for failure messages.
 */
function describeFileStatus(file: LocalFile): string {
  if (file.pdmData?.checked_out_by) return 'checked-out'
  if (file.diffStatus === 'cloud') return 'cloud'
  if (file.diffStatus === 'added') return 'added'
  if (file.diffStatus === 'deleted') return 'deleted'
  if (file.diffStatus === 'deleted_remote') return 'deleted_remote'
  if (file.pdmData) return 'synced'
  return 'unknown'
}

// ============================================
// Assert Handler
// ============================================

/**
 * Execute the `assert` command.
 *
 * Validates one or more properties of a file against expected values.
 * Outputs PASS or FAIL lines that the test runner can parse.
 *
 * @param parsed - Parsed command (args[0] = file path, flags = assertions)
 * @param files  - Current file list from the store
 * @param addOutput - Function to emit terminal output
 */
export async function handleAssert(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
): Promise<void> {
  const path = parsed.args[0]
  if (!path) {
    addOutput('error', 'FAIL: Usage: assert <path> --status=<value> [--version=<n>] ...')
    return
  }

  // --exists / --not-exists: check file presence in vault store
  const checkExists = parsed.flags['exists'] === true
  const checkNotExists = parsed.flags['not-exists'] === true

  if (checkNotExists) {
    const matches = resolvePathPattern(path, files)
    if (matches.length === 0) {
      addOutput('success', `PASS: file does not exist in vault — ${path}`)
    } else {
      addOutput(
        'error',
        `FAIL: expected file to NOT exist, but found ${matches.length} match(es) — ${path}`,
      )
    }
    return
  }

  // Resolve the file (required for all remaining assertions)
  const matches = resolvePathPattern(path, files)

  if (checkExists) {
    if (matches.length > 0) {
      addOutput('success', `PASS: file exists in vault — ${path}`)
    } else {
      addOutput('error', `FAIL: expected file to exist, but not found — ${path}`)
    }
    return
  }

  if (matches.length === 0) {
    addOutput('error', `FAIL: file not found — ${path}`)
    return
  }

  const file = matches[0]

  /**
   * Helper to record one assertion result.
   * Returns true if the assertion passed, false otherwise.
   */
  function check(label: string, expected: string, actual: string, pass: boolean): boolean {
    if (pass) {
      addOutput('success', `PASS: ${label} — expected: ${expected}, got: ${actual}`)
    } else {
      addOutput('error', `FAIL: ${label} — expected: ${expected}, got: ${actual}`)
    }
    return pass
  }

  // --status
  if (typeof parsed.flags['status'] === 'string') {
    const expectedStatus = parsed.flags['status']
    if (!isStatusAssertion(expectedStatus)) {
      addOutput(
        'error',
        `FAIL: invalid --status value "${expectedStatus}". Valid: checked-out, synced, cloud, added, deleted, deleted_remote`,
      )
      return
    }

    const actualStatus = describeFileStatus(file)
    check(`status of ${file.name}`, expectedStatus, actualStatus, actualStatus === expectedStatus)
  }

  // --version
  if (typeof parsed.flags['version'] === 'string') {
    const expectedVersion = parseInt(parsed.flags['version'], 10)
    const actualVersion = file.pdmData?.version
    check(
      `version of ${file.name}`,
      String(expectedVersion),
      String(actualVersion ?? 'undefined'),
      actualVersion === expectedVersion,
    )
  }

  // --part
  if (typeof parsed.flags['part'] === 'string') {
    const expectedPart = parsed.flags['part']
    const actualPart = resolvePartNumber(file).value
    check(
      `part_number of ${file.name}`,
      expectedPart,
      String(actualPart ?? 'null'),
      actualPart === expectedPart,
    )
  }

  // --desc
  if (typeof parsed.flags['desc'] === 'string') {
    const expectedDesc = parsed.flags['desc']
    const actualDesc = resolveDescription(file).value
    check(
      `description of ${file.name}`,
      expectedDesc,
      String(actualDesc ?? 'null'),
      actualDesc === expectedDesc,
    )
  }

  // --rev
  if (typeof parsed.flags['rev'] === 'string') {
    const expectedRev = parsed.flags['rev']
    const actualRev = resolveRevision(file).value
    check(
      `revision of ${file.name}`,
      expectedRev,
      String(actualRev ?? 'null'),
      actualRev === expectedRev,
    )
  }

  // --readonly / --writable
  if (parsed.flags['readonly'] === true || parsed.flags['writable'] === true) {
    const expectReadonly = parsed.flags['readonly'] === true
    const fullPath = file.path

    try {
      // The isReadonly IPC bridge may not exist yet (being added by another agent).
      // Use a safe check before calling it.
      if (typeof window.electronAPI?.isReadonly === 'function') {
        const result = await window.electronAPI.isReadonly(fullPath)
        if (result.success && result.readonly !== undefined) {
          const actualReadonly = result.readonly
          if (expectReadonly) {
            check(
              `readonly attribute of ${file.name}`,
              'readonly',
              actualReadonly ? 'readonly' : 'writable',
              actualReadonly,
            )
          } else {
            check(
              `writable attribute of ${file.name}`,
              'writable',
              actualReadonly ? 'readonly' : 'writable',
              !actualReadonly,
            )
          }
        } else {
          addOutput(
            'error',
            `FAIL: could not read file attributes for ${file.name} — ${result.error ?? 'unknown error'}`,
          )
        }
      } else {
        addOutput(
          'info',
          `SKIP: isReadonly IPC not available — cannot verify file attributes for ${file.name}`,
        )
      }
    } catch (error) {
      addOutput(
        'error',
        `FAIL: error checking file attributes for ${file.name} — ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // --checked-out-by
  if (typeof parsed.flags['checked-out-by'] === 'string') {
    const expectedBy = parsed.flags['checked-out-by']
    const checkedOutBy = file.pdmData?.checked_out_by ?? null

    if (expectedBy.toLowerCase() === 'me') {
      const { user } = usePDMStore.getState()
      const isMe = checkedOutBy === user?.id
      check(
        `checked-out-by of ${file.name}`,
        'me (current user)',
        isMe ? 'me (current user)' : String(checkedOutBy ?? 'nobody'),
        isMe,
      )
    } else {
      // Compare with email — look up the email from the checked_out_user join
      const actualEmail = file.pdmData?.checked_out_user?.email ?? null
      check(
        `checked-out-by of ${file.name}`,
        expectedBy,
        String(actualEmail ?? checkedOutBy ?? 'nobody'),
        actualEmail === expectedBy,
      )
    }
  }

  // --state
  if (typeof parsed.flags['state'] === 'string') {
    const expectedState = parsed.flags['state']
    if (!isWorkflowState(expectedState)) {
      addOutput(
        'error',
        `FAIL: invalid --state value "${expectedState}". Valid: wip, in_review, released, obsolete`,
      )
    } else {
      const actualState = file.pdmData?.workflow_state?.name ?? null
      check(
        `workflow state of ${file.name}`,
        expectedState,
        String(actualState ?? 'null'),
        actualState === expectedState,
      )
    }
  }

  // --has-pending / --no-pending
  if (parsed.flags['has-pending'] === true) {
    const hasPending =
      file.pendingMetadata !== undefined && Object.keys(file.pendingMetadata).length > 0
    check(
      `pending metadata of ${file.name}`,
      'has pending changes',
      hasPending ? 'has pending changes' : 'no pending changes',
      hasPending,
    )
  }

  if (parsed.flags['no-pending'] === true) {
    const hasPending =
      file.pendingMetadata !== undefined && Object.keys(file.pendingMetadata).length > 0
    check(
      `pending metadata of ${file.name}`,
      'no pending changes',
      hasPending ? 'has pending changes' : 'no pending changes',
      !hasPending,
    )
  }

  // If no specific flags were provided, show a helpful message
  const assertionFlags = [
    'status',
    'version',
    'part',
    'desc',
    'rev',
    'readonly',
    'writable',
    'exists',
    'not-exists',
    'checked-out-by',
    'state',
    'has-pending',
    'no-pending',
  ]
  const hasAnyFlag = assertionFlags.some((f) => parsed.flags[f] !== undefined)
  if (!hasAnyFlag) {
    addOutput(
      'error',
      'FAIL: no assertion flags provided. Use --status, --version, --part, --desc, --rev, --readonly, --writable, --exists, --not-exists, --checked-out-by, --state, --has-pending, --no-pending',
    )
  }
}

// ============================================
// Wait Handler
// ============================================

/**
 * Execute the `wait` command.
 *
 * Pauses execution for the specified number of milliseconds.
 * Useful for letting async operations (sync, download, etc.) settle
 * before running assertions in a test script.
 *
 * @param parsed - Parsed command (args[0] = milliseconds to wait)
 * @param addOutput - Function to emit terminal output
 */
export async function handleWait(parsed: ParsedCommand, addOutput: OutputFn): Promise<void> {
  const msArg = parsed.args[0]
  if (!msArg) {
    addOutput('error', 'Usage: wait <milliseconds>')
    return
  }

  const ms = parseInt(msArg, 10)
  if (isNaN(ms) || ms < 0) {
    addOutput('error', `Invalid wait time: ${msArg}. Must be a non-negative integer.`)
    return
  }

  if (ms > 0) {
    addOutput('info', `Waiting ${ms}ms...`)
    await new Promise<void>((resolve) => setTimeout(resolve, ms))
  }

  addOutput('success', `Waited ${ms}ms`)
}

// ============================================
// Self-registration
// ============================================

registerTerminalCommand(
  {
    aliases: ['assert', 'expect'],
    description: 'Assert file properties (for test scripts)',
    usage:
      'assert <path> --status=<value> [--version=<n>] [--part=<value>] [--desc=<value>] [--rev=<value>] [--readonly] [--writable] [--exists] [--not-exists] [--checked-out-by=<me|email>] [--state=<wip|in_review|released|obsolete>] [--has-pending] [--no-pending]',
    examples: [
      'assert Parts/bracket.sldprt --status=synced --version=1',
      'assert Parts/bracket.sldprt --status=checked-out --checked-out-by=me',
      'assert Parts/new-file.sldprt --not-exists',
    ],
    category: 'info',
  },
  async (parsed, files, addOutput) => {
    await handleAssert(parsed, files, addOutput)
  },
)

registerTerminalCommand(
  {
    aliases: ['wait', 'sleep'],
    description: 'Pause execution for N milliseconds',
    usage: 'wait <milliseconds>',
    examples: ['wait 2000', 'sleep 500'],
    category: 'terminal',
  },
  async (parsed, _files, addOutput) => {
    await handleWait(parsed, addOutput)
  },
)
