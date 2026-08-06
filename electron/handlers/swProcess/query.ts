import { execFile } from 'child_process'
import { promisify } from 'util'

import type { LiveSwProcess, SwProcessQueryResult } from './types'

const execFileAsync = promisify(execFile)

/** Budget for a process enumeration. Generous: it runs rarely. */
const QUERY_TIMEOUT_MS = 10_000

/**
 * Emits one line per SLDWORKS.exe as `pid<TAB>startTimeIso<TAB>windowTitle`.
 *
 * The start time is left empty when Windows refuses it (a process owned by
 * another user, or one that exited mid-query), which downstream reads as
 * "identity unknown" rather than as a match.
 *
 * Kept to a single line, and closed with an explicit `exit 0`, because
 * PowerShell exits non-zero when the last statement raised an error — which is
 * what `Get-Process` does when no SolidWorks is running, the very case that
 * must read as "none" rather than as a failed query.
 */
const LIST_PROCESSES_SCRIPT =
  `$ErrorActionPreference = 'SilentlyContinue'; ` +
  `foreach ($p in Get-Process -Name SLDWORKS) { ` +
  `$start = ''; try { $start = $p.StartTime.ToUniversalTime().ToString('o') } catch { }; ` +
  `$title = ''; try { $title = $p.MainWindowTitle } catch { }; ` +
  `Write-Output ("{0}\`t{1}\`t{2}" -f $p.Id, $start, ($title -replace '\\s+', ' ')) }; ` +
  `exit 0`

export function parsePowerShellOutput(stdout: string): LiveSwProcess[] {
  const processes: LiveSwProcess[] = []

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue

    const [rawPid, rawStart, rawTitle] = line.split('\t')
    const pid = Number.parseInt(rawPid, 10)
    if (Number.isNaN(pid)) continue

    const parsedStart = rawStart ? Date.parse(rawStart) : Number.NaN

    processes.push({
      pid,
      startedAt: Number.isNaN(parsedStart) ? null : parsedStart,
      windowTitle: (rawTitle ?? '').trim(),
    })
  }

  return processes
}

export function parseTasklistOutput(stdout: string): LiveSwProcess[] {
  const processes: LiveSwProcess[] = []

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.includes('SLDWORKS.exe')) continue

    const fields = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)
    if (!fields || fields.length < 2) continue

    const pid = Number.parseInt(fields[1].replace(/"/g, ''), 10)
    if (Number.isNaN(pid)) continue

    processes.push({
      pid,
      startedAt: null,
      windowTitle: fields.length >= 9 ? fields[8].replace(/"/g, '') : '',
    })
  }

  return processes
}

/**
 * Lists every running SLDWORKS.exe with the start time that, together with the
 * PID, identifies it across a PID recycle.
 *
 * Falls back to `tasklist` when PowerShell is unavailable. That fallback cannot
 * report start times, so every process it returns is unidentifiable and the
 * classifier keeps all of them — losing the ability to reap rather than
 * guessing at ownership.
 */
export async function querySwProcesses(): Promise<SwProcessQueryResult> {
  if (process.platform !== 'win32') {
    return { processes: [], source: 'unsupported' }
  }

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', LIST_PROCESSES_SCRIPT],
      { timeout: QUERY_TIMEOUT_MS, windowsHide: true },
    )
    return { processes: parsePowerShellOutput(stdout), source: 'powershell' }
  } catch (error) {
    try {
      const { stdout } = await execFileAsync(
        'tasklist',
        ['/V', '/FI', 'IMAGENAME eq SLDWORKS.exe', '/FO', 'CSV', '/NH'],
        { timeout: QUERY_TIMEOUT_MS, windowsHide: true },
      )
      return {
        processes: parseTasklistOutput(stdout),
        source: 'tasklist',
        degradedReason: `PowerShell process query failed: ${String(error)}`,
      }
    } catch {
      return {
        processes: [],
        source: 'none',
        degradedReason: `No process query succeeded: ${String(error)}`,
      }
    }
  }
}

/**
 * Start time of one process, used to pin ownership at launch. Null when it
 * cannot be read, which permanently marks that record unverifiable rather than
 * letting a later PID match stand in for identity.
 */
export async function querySwProcessStartTime(pid: number): Promise<number | null> {
  const { processes } = await querySwProcesses()
  return processes.find((proc) => proc.pid === pid)?.startedAt ?? null
}

/** Asks a process to close its windows. Never forces: SolidWorks may prompt. */
export async function requestSwProcessClose(pid: number): Promise<void> {
  await execFileAsync('taskkill', ['/PID', String(pid)], {
    timeout: QUERY_TIMEOUT_MS,
    windowsHide: true,
  })
}
