import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearSwReferencesCache,
  getSwReferencesCached,
  isReferencesUnresolved,
} from './referencesCache'
import { REFERENCES_UNRESOLVED } from './types'

const PATH = 'C:\\Vault\\Parts\\ORING-BUNA-70A-265.SLDDRW'

/** One resolved reference, in the shape the service sends. */
function resolved() {
  return {
    success: true,
    data: {
      filePath: PATH,
      references: [
        {
          path: 'C:\\Vault\\Parts\\ORING-BUNA-70A.SLDPRT',
          fileName: 'ORING-BUNA-70A.SLDPRT',
          exists: true,
          fileType: 'Part',
          configuration: '-265',
        },
      ],
      count: 1,
    },
  }
}

let getReferences: ReturnType<typeof vi.fn>

beforeEach(() => {
  clearSwReferencesCache()
  getReferences = vi.fn().mockResolvedValue(resolved())
  vi.stubGlobal('window', { electronAPI: { solidworks: { getReferences } } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('who asked decides how the read is answered', () => {
  it('asks in the background unless told otherwise, so no caller can open a window by omission', async () => {
    await getSwReferencesCached(PATH)

    expect(getReferences).toHaveBeenCalledWith(PATH, 'background')
  })

  it('passes foreground through, which is the only origin allowed to open a document', async () => {
    await getSwReferencesCached(PATH, 'foreground')

    expect(getReferences).toHaveBeenCalledWith(PATH, 'foreground')
  })

  it('does not serve a foreground retry from a background call still in flight', async () => {
    let releaseBackground: (value: unknown) => void = () => {}
    getReferences.mockImplementationOnce(
      () => new Promise((resolve) => (releaseBackground = resolve)),
    )

    const background = getSwReferencesCached(PATH)
    const foreground = getSwReferencesCached(PATH, 'foreground')

    expect(getReferences).toHaveBeenCalledTimes(2)
    expect(getReferences.mock.calls[1][1]).toBe('foreground')

    releaseBackground(resolved())
    await Promise.all([background, foreground])
  })

  it('lands a superseded background call without marking the foreground read cached', async () => {
    let releaseBackground: (value: unknown) => void = () => {}
    getReferences.mockImplementationOnce(
      () => new Promise((resolve) => (releaseBackground = resolve)),
    )

    const background = getSwReferencesCached(PATH)
    await getSwReferencesCached(PATH, 'foreground')

    releaseBackground(resolved())
    await background

    // The entry the foreground read installed is the live one, so a later reader reuses it.
    await getSwReferencesCached(PATH)
    expect(getReferences).toHaveBeenCalledTimes(2)
  })
})

describe('sharing one read between callers', () => {
  it('answers a second caller from the first call rather than paying for the queue twice', async () => {
    await Promise.all([getSwReferencesCached(PATH), getSwReferencesCached(PATH)])

    expect(getReferences).toHaveBeenCalledTimes(1)
  })

  it('does not memoize a failure, because these are usually transient', async () => {
    getReferences.mockResolvedValueOnce({ success: false, error: 'SOLIDWORKS_NOT_RUNNING' })

    await getSwReferencesCached(PATH)
    await getSwReferencesCached(PATH)

    expect(getReferences).toHaveBeenCalledTimes(2)
  })

  it('drops everything when the batch that read it says the disk has moved on', async () => {
    await getSwReferencesCached(PATH)
    clearSwReferencesCache()
    await getSwReferencesCached(PATH)

    expect(getReferences).toHaveBeenCalledTimes(2)
  })
})

describe('unresolved is not the same answer as none', () => {
  it('recognises the service declining to answer', async () => {
    getReferences.mockResolvedValueOnce({ success: false, error: REFERENCES_UNRESOLVED })

    expect(isReferencesUnresolved(await getSwReferencesCached(PATH))).toBe(true)
  })

  it('does not mistake a file that genuinely has no references for one it could not read', async () => {
    getReferences.mockResolvedValueOnce({
      success: true,
      data: { filePath: PATH, references: [], count: 0 },
    })

    const result = await getSwReferencesCached(PATH)

    expect(isReferencesUnresolved(result)).toBe(false)
    expect(result?.data?.references).toEqual([])
  })

  it('does not mistake an ordinary failure for a considered "cannot tell"', async () => {
    getReferences.mockResolvedValueOnce({ success: false, error: 'SOLIDWORKS_NOT_RUNNING' })

    expect(isReferencesUnresolved(await getSwReferencesCached(PATH))).toBe(false)
  })
})
