import { randomUUID } from 'crypto'
import fs from 'fs'

import type { SwOwnershipRecord } from './types'

/**
 * Durable registry of SolidWorks processes BluePLM launched.
 *
 * It has to survive an app restart. Ownership held only in memory is lost the
 * moment BluePLM crashes, and a crash is precisely the event that leaks a
 * headless SolidWorks — so an in-memory-only registry makes the instances the
 * watchdog exists for permanently unreapable, while making everything else look
 * unowned.
 */

const STORE_VERSION = 1

interface StoreFile {
  version: number
  records: SwOwnershipRecord[]
}

type Logger = (message: string, data?: unknown) => void

export interface SwOwnershipStoreOptions {
  /** JSON file the registry is persisted to. */
  filePath: string
  /** Identifier for this app run. Generated when omitted. */
  sessionId?: string
  /** Liveness probe for the BluePLM process that owns a record. */
  isProcessAlive?: (pid: number) => boolean
  log?: Logger
}

let storeFilePath: string | null = null
let currentSessionId = ''
let isOwnerAlive: (pid: number) => boolean = defaultIsProcessAlive
let log: Logger = () => {}

const records = new Map<number, SwOwnershipRecord>()

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function isOwnershipRecord(value: unknown): value is SwOwnershipRecord {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.pid === 'number' &&
    (typeof candidate.startedAt === 'number' || candidate.startedAt === null) &&
    typeof candidate.inUse === 'boolean' &&
    typeof candidate.sessionId === 'string' &&
    typeof candidate.ownerPid === 'number' &&
    typeof candidate.recordedAt === 'number' &&
    typeof candidate.closeRequests === 'number' &&
    (typeof candidate.lastCloseRequestAt === 'number' || candidate.lastCloseRequestAt === null) &&
    (typeof candidate.abandonedAt === 'number' || candidate.abandonedAt === null)
  )
}

function readStoreFile(filePath: string): SwOwnershipRecord[] {
  if (!fs.existsSync(filePath)) return []

  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return []

    const stored = parsed as Partial<StoreFile>
    if (!Array.isArray(stored.records)) return []

    return stored.records.filter(isOwnershipRecord)
  } catch (error) {
    log(`[SolidWorks Ownership] Could not read ownership registry: ${String(error)}`)
    return []
  }
}

function persist(): void {
  if (!storeFilePath) return

  const payload: StoreFile = { version: STORE_VERSION, records: [...records.values()] }
  const tempPath = `${storeFilePath}.tmp`

  try {
    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8')
    fs.renameSync(tempPath, storeFilePath)
  } catch (error) {
    log(`[SolidWorks Ownership] Could not persist ownership registry: ${String(error)}`)
  }
}

/**
 * Loads the registry and adopts records left behind by earlier runs.
 *
 * A record whose owning BluePLM process is gone describes an instance nobody is
 * holding any more, so it becomes reapable. A record whose owner is still alive
 * is left alone: another BluePLM is using that instance.
 */
export function initSwOwnershipStore(options: SwOwnershipStoreOptions): void {
  storeFilePath = options.filePath
  currentSessionId = options.sessionId ?? randomUUID()
  isOwnerAlive = options.isProcessAlive ?? defaultIsProcessAlive
  log = options.log ?? (() => {})

  records.clear()

  let inherited = 0
  for (const stored of readStoreFile(options.filePath)) {
    const ownerGone = stored.sessionId !== currentSessionId && !isOwnerAlive(stored.ownerPid)
    const record: SwOwnershipRecord = ownerGone ? { ...stored, inUse: false } : { ...stored }

    if (ownerGone && stored.inUse) inherited++
    records.set(record.pid, record)
  }

  if (inherited > 0) {
    log(
      `[SolidWorks Ownership] Adopted ${inherited} SolidWorks instance(s) left behind by a previous run`,
      { sessionId: currentSessionId },
    )
  }

  persist()
}

export function getSwSessionId(): string {
  return currentSessionId
}

/** Records that BluePLM launched this exact process. */
export function recordSwLaunch(pid: number, startedAt: number | null): SwOwnershipRecord {
  const record: SwOwnershipRecord = {
    pid,
    startedAt,
    inUse: true,
    sessionId: currentSessionId,
    ownerPid: process.pid,
    recordedAt: Date.now(),
    closeRequests: 0,
    lastCloseRequestAt: null,
    abandonedAt: null,
  }

  records.set(pid, record)
  persist()
  return record
}

export function getSwOwnershipRecord(pid: number): SwOwnershipRecord | undefined {
  return records.get(pid)
}

export function listSwOwnershipRecords(): SwOwnershipRecord[] {
  return [...records.values()]
}

/** Marks one instance as no longer held, making it a reap candidate. */
export function releaseSwProcess(pid: number): SwOwnershipRecord | undefined {
  const record = records.get(pid)
  if (!record || !record.inUse) return record

  const released: SwOwnershipRecord = { ...record, inUse: false }
  records.set(pid, released)
  persist()
  return released
}

/** Marks every instance this run launched as no longer held. */
export function releaseAllSwProcesses(): SwOwnershipRecord[] {
  const released: SwOwnershipRecord[] = []

  for (const record of records.values()) {
    if (record.sessionId !== currentSessionId || !record.inUse) continue
    const next: SwOwnershipRecord = { ...record, inUse: false }
    records.set(record.pid, next)
    released.push(next)
  }

  if (released.length > 0) persist()
  return released
}

/** Drops a record entirely, e.g. once its process has exited. */
export function forgetSwProcess(pid: number): void {
  if (records.delete(pid)) persist()
}

export function noteSwCloseRequest(pid: number, now: number): void {
  const record = records.get(pid)
  if (!record) return

  records.set(pid, {
    ...record,
    closeRequests: record.closeRequests + 1,
    lastCloseRequestAt: now,
  })
  persist()
}

export function abandonSwProcess(pid: number, now: number): void {
  const record = records.get(pid)
  if (!record || record.abandonedAt !== null) return

  records.set(pid, { ...record, abandonedAt: now })
  persist()
}

/**
 * True when at least one recorded instance might still need reaping. The
 * watchdog uses this to avoid enumerating processes at all — and so to avoid
 * ever forming an opinion about a user's SolidWorks — when there is nothing of
 * ours outstanding.
 */
export function hasSwReapCandidates(): boolean {
  for (const record of records.values()) {
    if (!record.inUse && record.abandonedAt === null) return true
  }
  return false
}
