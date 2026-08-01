// SolidWorks Service Type Definitions

/**
 * Status snapshot of the SolidWorks helper service, as reported by the main
 * process `solidworks:get-service-status` IPC handler.
 */
export interface SolidWorksServiceStatus {
  running: boolean
  busy?: boolean
  version?: string
  swInstalled?: boolean
  dmApiAvailable?: boolean
  dmApiError?: string | null
  queueDepth?: number
  error?: string
}

/**
 * Whether the service process can accept commands right now.
 *
 * `busy` means the process is alive but couldn't answer a ping because a real
 * command is occupying its single command thread. Commands still queue and
 * execute normally in that state, so it does not mean offline.
 */
export function isSolidWorksAlive(status: SolidWorksServiceStatus): boolean {
  return status.running || status.busy === true
}

/**
 * Whether Document Manager backed operations (property read/write, BOM,
 * references, previews) can be dispatched right now.
 */
export function isSolidWorksUsable(status: SolidWorksServiceStatus): boolean {
  return isSolidWorksAlive(status) && status.dmApiAvailable === true
}
