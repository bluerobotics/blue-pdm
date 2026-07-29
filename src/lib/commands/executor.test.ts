import { describe, expect, it, beforeEach, vi } from 'vitest'

const storeMock = {
  addToast: vi.fn(),
  addProgressToast: vi.fn(),
  updateProgressToast: vi.fn(),
  removeToast: vi.fn(),
  isProgressToastCancelled: vi.fn(() => false),
  isOperationRunning: false,
  operationQueue: [] as unknown[],
  processingOperations: new Map<string, string>(),
}

vi.mock('../../stores/pdmStore', () => ({
  usePDMStore: { getState: () => storeMock },
}))

vi.mock('../userActionLogger', () => ({ logUserAction: vi.fn() }))

vi.mock('../logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { executeCommand, registerCommand, ProgressTracker, hasActiveOperations } = await import(
  './executor'
)
import type { Command, CommandContext, CommandId } from './types'

/**
 * Registers a fake command that opens a progress toast and then either throws or
 * finishes cleanly, mirroring how the real move command uses ProgressTracker.
 */
function registerProbeCommand(id: CommandId, toastId: string, shouldThrow: boolean): void {
  const probe: Command<Record<string, never>> = {
    id,
    name: 'Probe',
    description: 'Test command',
    usage: 'probe',
    validate: () => null,
    async execute(_params, ctx: CommandContext) {
      const progress = new ProgressTracker(ctx, id, toastId, 'Working...', 3)
      if (shouldThrow) {
        throw new Error('boom')
      }
      progress.finish()
      return { success: true, message: 'ok', total: 3, succeeded: 3, failed: 0 }
    },
  }
  registerCommand(id, probe as never)
}

describe('executeCommandDirect progress toast cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('removes the progress toast when a command throws', async () => {
    registerProbeCommand('move' as CommandId, 'move-toast-1', true)

    const result = await executeCommand('move' as CommandId, {} as never)

    expect(result.success).toBe(false)
    expect(result.message).toBe('boom')
    expect(storeMock.addProgressToast).toHaveBeenCalledWith('move-toast-1', 'Working...', 3)
    expect(storeMock.removeToast).toHaveBeenCalledWith('move-toast-1')
    expect(hasActiveOperations()).toBe(false)
  })

  it('leaves no active operation behind on the success path', async () => {
    registerProbeCommand('move' as CommandId, 'move-toast-2', false)

    const result = await executeCommand('move' as CommandId, {} as never)

    expect(result.success).toBe(true)
    expect(storeMock.removeToast).toHaveBeenCalledWith('move-toast-2')
    expect(hasActiveOperations()).toBe(false)
  })
})
