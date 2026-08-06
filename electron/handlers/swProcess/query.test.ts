import { describe, expect, it } from 'vitest'

import { parsePowerShellOutput, parseTasklistOutput } from './query'

describe('parsePowerShellOutput', () => {
  it('reads the pid, start time and title of each process', () => {
    const stdout =
      '20396\t2026-08-06T16:15:12.4513362Z\tSOLIDWORKS 2024 SP5.0\r\n' +
      '12340\t2026-08-06T16:16:26.3172454Z\t__wglDummyWindowFodder\r\n'

    expect(parsePowerShellOutput(stdout)).toEqual([
      {
        pid: 20396,
        startedAt: Date.parse('2026-08-06T16:15:12.451Z'),
        windowTitle: 'SOLIDWORKS 2024 SP5.0',
      },
      {
        pid: 12340,
        startedAt: Date.parse('2026-08-06T16:16:26.317Z'),
        windowTitle: '__wglDummyWindowFodder',
      },
    ])
  })

  it('reports an unreadable start time as unknown rather than guessing one', () => {
    const [proc] = parsePowerShellOutput('20396\t\t\r\n')

    expect(proc.startedAt).toBeNull()
    expect(proc.windowTitle).toBe('')
  })

  it('skips lines that are not a process', () => {
    expect(parsePowerShellOutput('\r\nnot-a-pid\tx\ty\r\n')).toEqual([])
  })
})

describe('parseTasklistOutput', () => {
  it('reads pids and titles but never a start time', () => {
    const stdout =
      '"SLDWORKS.exe","20396","Console","1","2,000 K","Running","BR\\makenna","0:12:31","SOLIDWORKS 2024 SP5.0"\r\n'

    expect(parseTasklistOutput(stdout)).toEqual([
      { pid: 20396, startedAt: null, windowTitle: 'SOLIDWORKS 2024 SP5.0' },
    ])
  })

  it('ignores lines for other images', () => {
    expect(parseTasklistOutput('"notepad.exe","4","Console","1"\r\n')).toEqual([])
  })
})
