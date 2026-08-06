/**
 * `scan-divergence` - the read-only divergence scanner.
 *
 * Phase 0 of `.cursor/plans/metadata-source-of-truth.plan.md`. Measures how far the database and
 * the SolidWorks files have drifted apart before anything is changed, because the files still hold
 * the only surviving copy of what the `jsonb ||` configuration-map wipe destroyed.
 *
 * The scanner cannot write. Every import below is either the pure comparison logic, a SELECT-only
 * database read, or the report writer, which puts its artifact in the log directory. Nothing from
 * `lib/supabase/files/`, nothing from `syncMetadata`, no `setProperties` - see the contract at the
 * top of `lib/metadata/divergenceScan.ts`.
 *
 * Usage:
 *   scan-divergence [--path=<prefix>] [--limit=<n>] [--drawings] [--verify-hashes]
 *                   [--repeat=<n>] [--no-timing] [--async]
 *   scan-divergence status
 *   scan-divergence cancel
 *   scan-divergence timing <relative-path> [--repeat=<n>]
 */

import { log } from '@/lib/logger'
import { t } from '@/lib/i18n'

import { usePDMStore } from '../../../stores/pdmStore'
import { registerTerminalCommand } from '../registry'
import type { ParsedCommand, TerminalOutput } from '../parser'

import {
  measureReadBack,
  resolveAbsolutePath,
  runDivergenceScan,
  type DivergenceReport,
  type DivergenceScanOptions,
} from '@/lib/metadata/divergenceScan'
import { formatDivergenceReport, writeDivergenceArtifact } from '@/lib/metadata/divergenceReport'

type OutputFn = (type: TerminalOutput['type'], content: string) => void

/** Read-back samples per file when `--repeat` is not given. */
const DEFAULT_TIMING_REPEATS = 5

/** Progress lines retained for `status`; enough to see movement without unbounded growth. */
const MAX_RETAINED_PROGRESS = 200

// ============================================
// Run state
// ============================================

type RunState = 'running' | 'complete' | 'failed' | 'cancelled'

interface ScanRun {
  id: string
  startedAt: number
  state: RunState
  progress: string[]
  summaryLines: string[]
  artifactPath: string | null
  error: string | null
  cancelRequested: boolean
}

/**
 * The scan outlives a single command invocation so the npm entry point can start it and poll,
 * rather than holding an HTTP request open past the CLI server's timeout.
 */
let currentRun: ScanRun | null = null

function startRun(): ScanRun {
  const run: ScanRun = {
    id: `divergence-${Date.now()}`,
    startedAt: Date.now(),
    state: 'running',
    progress: [],
    summaryLines: [],
    artifactPath: null,
    error: null,
    cancelRequested: false,
  }
  currentRun = run
  return run
}

function recordProgress(run: ScanRun, message: string): void {
  run.progress.push(message)
  if (run.progress.length > MAX_RETAINED_PROGRESS) run.progress.shift()
}

// ============================================
// Context
// ============================================

interface ScanContext {
  orgId: string
  vaultId: string | null
  vaultPath: string
}

function resolveContext(addOutput: OutputFn): ScanContext | null {
  const { organization, activeVaultId, vaultPath } = usePDMStore.getState()

  if (!organization?.id) {
    addOutput('error', t('divergence.noOrganization', 'Not signed in to an organization.'))
    return null
  }
  if (!vaultPath) {
    addOutput('error', t('divergence.noVault', 'No vault is connected.'))
    return null
  }

  return { orgId: organization.id, vaultId: activeVaultId, vaultPath }
}

function numericFlag(parsed: ParsedCommand, name: string): number | undefined {
  const raw = parsed.flags[name]
  if (typeof raw !== 'string') return undefined
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function stringFlag(parsed: ParsedCommand, name: string): string | undefined {
  const raw = parsed.flags[name]
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

// ============================================
// The scan
// ============================================

async function executeScan(run: ScanRun, options: DivergenceScanOptions): Promise<void> {
  try {
    const report = await runDivergenceScan(options)
    run.summaryLines = formatDivergenceReport(report)

    try {
      run.artifactPath = await writeDivergenceArtifact(report)
    } catch (error) {
      // A report we can read but not save is still worth having, so this does not fail the run.
      run.summaryLines.push(
        t('divergence.artifactFailed', {
          reason: error instanceof Error ? error.message : String(error),
        }),
      )
    }

    run.state = report.cancelled ? 'cancelled' : 'complete'
    logCompletion(report)
  } catch (error) {
    run.state = 'failed'
    run.error = error instanceof Error ? error.message : String(error)
    log.error('[ScanDivergence]', 'Scan failed', { error: run.error })
  }
}

function logCompletion(report: DivergenceReport): void {
  log.info('[ScanDivergence]', 'Scan complete', {
    filesCompared: report.counts.filesCompared,
    filesWithTruncatedConfigMap: report.summary.filesWithTruncatedConfigMap,
    unrecoverableValues: report.summary.unrecoverableValues,
    disagreeingValues: report.summary.disagreeingValues,
    durationMs: report.durationMs,
  })
}

async function handleScan(parsed: ParsedCommand, addOutput: OutputFn): Promise<void> {
  if (currentRun?.state === 'running') {
    addOutput(
      'error',
      t('divergence.alreadyRunning', 'A scan is already running. Use "scan-divergence status".'),
    )
    return
  }

  const context = resolveContext(addOutput)
  if (!context) return

  const run = startRun()
  const runInBackground = parsed.flags.async === true

  const options: DivergenceScanOptions = {
    ...context,
    pathPrefix: stringFlag(parsed, 'path'),
    limit: numericFlag(parsed, 'limit'),
    includeDrawings: parsed.flags.drawings === true,
    verifyHashesEverywhere: parsed.flags['verify-hashes'] === true,
    timingRepeats:
      parsed.flags['no-timing'] === true
        ? 0
        : (numericFlag(parsed, 'repeat') ?? DEFAULT_TIMING_REPEATS),
    shouldCancel: () => run.cancelRequested,
    onProgress: (message) => {
      recordProgress(run, message)
      if (!runInBackground) addOutput('info', message)
    },
  }

  addOutput(
    'info',
    t('divergence.starting', 'Scanning read-only. Nothing is written to the vault or the database.'),
  )

  if (runInBackground) {
    addOutput('info', t('divergence.startedAsync', { id: run.id }))
    void executeScan(run, options)
    return
  }

  await executeScan(run, options)
  printRun(run, addOutput)
}

function printRun(run: ScanRun, addOutput: OutputFn): void {
  if (run.state === 'failed') {
    addOutput('error', t('divergence.failed', { reason: run.error ?? '' }))
    return
  }

  for (const line of run.summaryLines) addOutput('output', line)

  if (run.artifactPath) {
    addOutput('success', t('divergence.artifact', { path: run.artifactPath }))
  }
}

// ============================================
// Subcommands
// ============================================

/** Prefix the npm entry point matches on. Diagnostic output, not a user-facing string. */
const STATE_MARKER = 'scan-divergence-state='

/**
 * A stable, untranslated first line so the npm entry point can tell a running scan from a
 * finished one without matching on prose that changes with the user's language.
 */
function emitState(addOutput: OutputFn, state: RunState | 'idle'): void {
  addOutput('output', `${STATE_MARKER}${state}`)
}

function handleStatus(addOutput: OutputFn): void {
  if (!currentRun) {
    emitState(addOutput, 'idle')
    addOutput('info', t('divergence.noRun', 'No scan has been run in this session.'))
    return
  }

  emitState(addOutput, currentRun.state)

  if (currentRun.state === 'running') {
    const last = currentRun.progress[currentRun.progress.length - 1] ?? ''
    addOutput(
      'info',
      t('divergence.running', {
        id: currentRun.id,
        seconds: Math.round((Date.now() - currentRun.startedAt) / 1000),
        progress: last,
      }),
    )
    return
  }

  addOutput('info', t('divergence.finished', { id: currentRun.id, state: currentRun.state }))
  printRun(currentRun, addOutput)
}

function handleCancel(addOutput: OutputFn): void {
  if (currentRun?.state !== 'running') {
    addOutput('info', t('divergence.nothingToCancel', 'No scan is running.'))
    return
  }
  currentRun.cancelRequested = true
  addOutput('info', t('divergence.cancelRequested', 'Cancelling after the file in flight.'))
}

/**
 * Time the read-back a verified write would need.
 *
 * Phase 4 of the plan is built around this number and the plan records it as unmeasured, so it is
 * measured here on whichever file the operator names - the 68-configuration part being the one
 * that settles whether the cost scales with the configuration count.
 */
async function handleTiming(parsed: ParsedCommand, addOutput: OutputFn): Promise<void> {
  const relativePath = parsed.args[1]
  if (!relativePath) {
    addOutput('error', t('divergence.timingUsage', 'Usage: scan-divergence timing <relative-path>'))
    return
  }

  const context = resolveContext(addOutput)
  if (!context) return

  const repeats = numericFlag(parsed, 'repeat') ?? DEFAULT_TIMING_REPEATS
  const absolutePath = resolveAbsolutePath(context.vaultPath, relativePath)

  addOutput('info', t('divergence.timingRunning', { path: relativePath, count: repeats }))

  try {
    const timing = await measureReadBack(absolutePath, relativePath, repeats)
    addOutput(
      'success',
      t('divergence.timingResult', {
        path: relativePath,
        configs: timing.configurationCount,
        median: timing.medianMs,
        min: timing.minMs,
        max: timing.maxMs,
      }),
    )
    addOutput('info', `  samples: ${timing.samplesMs.join(', ')} ms`)
  } catch (error) {
    addOutput(
      'error',
      t('divergence.timingFailed', {
        path: relativePath,
        reason: error instanceof Error ? error.message : String(error),
      }),
    )
  }
}

// ============================================
// Self-registration
// ============================================

registerTerminalCommand(
  {
    aliases: ['scan-divergence'],
    description: 'Report where the database and the SolidWorks files disagree (read-only)',
    usage:
      'scan-divergence [status|cancel|timing <path>] [--path=<prefix>] [--limit=<n>] [--no-timing] [--async]',
    examples: [
      'scan-divergence',
      'scan-divergence --path="0 - SHARED\\00 - REGRESSION TESTS"',
      'scan-divergence timing "0 - SHARED\\00 - REGRESSION TESTS\\REGRESSION-TEST-ORING\\ORING-BUNA-70A.SLDPRT"',
    ],
    category: 'admin',
  },
  async (parsed, _files, addOutput) => {
    switch (parsed.args[0]) {
      case 'status':
        handleStatus(addOutput)
        return
      case 'cancel':
        handleCancel(addOutput)
        return
      case 'timing':
        await handleTiming(parsed, addOutput)
        return
      default:
        await handleScan(parsed, addOutput)
    }
  },
)
