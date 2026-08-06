/**
 * Types for SolidWorks process provenance.
 *
 * The watchdog exists to reap headless SLDWORKS.exe instances BluePLM launched
 * and then leaked. Nothing about how a process *looks* (window title, document
 * state, idle time) distinguishes those from a user's own SolidWorks, so the
 * only admissible evidence is a record BluePLM wrote when it launched the
 * process. These types are that record and the observation it is matched
 * against.
 */

/** A live SLDWORKS.exe as observed on this machine. */
export interface LiveSwProcess {
  pid: number
  /**
   * Process creation time in milliseconds since the epoch, or null when Windows
   * would not report it (access denied, or the process exited mid-query).
   * Together with the PID this is the only stable identity a process has:
   * Windows recycles PIDs, and a recycled one can belong to anything.
   */
  startedAt: number | null
  /**
   * Main window title. Diagnostics only — it is never an input to the decision
   * to terminate. A SolidWorks that is mid-startup, hung, or minimised shows
   * `__wglDummyWindowFodder` (an OpenGL scratch window), and one BluePLM
   * launched itself shows an ordinary "SOLIDWORKS <year>" title, so the title
   * separates neither ours from theirs nor healthy from stuck.
   */
  windowTitle: string
}

/**
 * Where the process list came from, so logs can say how much was knowable.
 * `none` means no enumeration succeeded, which is not the same as "no processes
 * are running" and must never be read as "our instances have exited".
 */
export type SwProcessQuerySource = 'powershell' | 'tasklist' | 'unsupported' | 'none'

export interface SwProcessQueryResult {
  processes: LiveSwProcess[]
  source: SwProcessQuerySource
  /** Present when the richer query failed and a weaker one answered instead. */
  degradedReason?: string
}

/** Proof that BluePLM started one specific SolidWorks process. */
export interface SwOwnershipRecord {
  pid: number
  /** Creation time captured when the launch was recorded. Null if unknowable. */
  startedAt: number | null
  /**
   * True while the BluePLM service that launched it still holds it. Goes false
   * when the service releases the instance or dies, which is exactly when the
   * instance becomes a leak worth reaping.
   */
  inUse: boolean
  /** App run that launched it, for logs. */
  sessionId: string
  /** PID of the BluePLM main process that launched it. */
  ownerPid: number
  recordedAt: number
  /** Graceful close requests already sent to this process. */
  closeRequests: number
  lastCloseRequestAt: number | null
  /**
   * Set once the process has ignored every close request we are willing to
   * send. Abandoned instances are left running and logged rather than forced,
   * because a refusal to close is usually an unsaved-changes prompt.
   */
  abandonedAt: number | null
}
