import { describe, expect, it } from 'vitest'

import { parseWorkflowExport } from './workflowExport'

const validState = {
  key: 's1',
  name: 'Development',
  position_x: 10,
  position_y: 20,
}

describe('parseWorkflowExport rejections', () => {
  it('rejects anything that is not an object', () => {
    expect(parseWorkflowExport('nope')).toEqual({ ok: false, reason: 'not-an-object' })
    expect(parseWorkflowExport(null)).toEqual({ ok: false, reason: 'not-an-object' })
    expect(parseWorkflowExport([validState])).toEqual({ ok: false, reason: 'not-an-object' })
  })

  it('rejects a file with no states', () => {
    expect(parseWorkflowExport({ states: [] })).toEqual({ ok: false, reason: 'no-states' })
    expect(parseWorkflowExport({ transitions: [] })).toEqual({ ok: false, reason: 'no-states' })
  })

  it('rejects a state without a name', () => {
    expect(parseWorkflowExport({ states: [{ key: 's1' }] })).toEqual({
      ok: false,
      reason: 'bad-state',
    })
  })

  it('rejects duplicate state keys', () => {
    const result = parseWorkflowExport({ states: [validState, { ...validState, name: 'Other' }] })
    expect(result).toEqual({ ok: false, reason: 'bad-state' })
  })

  it('rejects a transition pointing at a state the file does not define', () => {
    const result = parseWorkflowExport({
      states: [validState],
      transitions: [{ from: 's1', to: 'missing' }],
    })
    expect(result).toEqual({ ok: false, reason: 'bad-transition' })
  })

  it('rejects a transition whose endpoints are not strings', () => {
    const result = parseWorkflowExport({
      states: [validState],
      transitions: [{ from: 's1', to: 42 }],
    })
    expect(result).toEqual({ ok: false, reason: 'bad-transition' })
  })
})

describe('parseWorkflowExport normalisation', () => {
  it('fills database defaults for fields a version 1 file omits', () => {
    const result = parseWorkflowExport({ states: [{ name: 'Development' }] })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const [state] = result.payload.states
    expect(state.key).toBe('Development')
    expect(state.shape).toBe('rectangle')
    expect(state.width).toBe(120)
    expect(state.height).toBe(60)
    expect(state.requires_checkout).toBe(true)
    expect(result.payload.version).toBe('1.0')
  })

  it('keys version 1 transitions by state name', () => {
    const result = parseWorkflowExport({
      states: [{ name: 'Development' }, { name: 'Released' }],
      transitions: [{ from_state: 'Development', to_state: 'Released' }],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.payload.transitions[0]).toMatchObject({ from: 'Development', to: 'Released' })
  })

  it('keeps layout and styling from a version 2 file', () => {
    const result = parseWorkflowExport({
      version: '2.0',
      states: [
        { ...validState, width: 200, height: 90, color: '#123456' },
        { key: 's2', name: 'Released' },
      ],
      transitions: [
        {
          from: 's1',
          to: 's2',
          line_path_type: 'elbow',
          start_edge: 'bottom',
          start_fraction: 0.25,
          waypoints: [{ x: 5, y: 6 }],
          label_pinned: { x: 1, y: 2 },
          gates: [{ name: 'QA sign-off', required_approvals: 2, is_blocking: true }],
        },
      ],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const [state] = result.payload.states
    expect(state).toMatchObject({ width: 200, height: 90, color: '#123456' })

    const [transition] = result.payload.transitions
    expect(transition).toMatchObject({
      line_path_type: 'elbow',
      start_edge: 'bottom',
      start_fraction: 0.25,
    })
    expect(transition.waypoints).toEqual([{ x: 5, y: 6 }])
    expect(transition.label_pinned).toEqual({ x: 1, y: 2 })
    expect(transition.gates[0]).toMatchObject({ name: 'QA sign-off', required_approvals: 2 })
  })

  it('drops values of the wrong type rather than passing them to the database', () => {
    const result = parseWorkflowExport({
      states: [{ name: 'Development', width: 'wide', sort_order: null }],
      transitions: [],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.payload.states[0].width).toBe(120)
    expect(result.payload.states[0].sort_order).toBe(0)
  })
})
