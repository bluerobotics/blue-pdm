import { describe, expect, it } from 'vitest'

import { DEFAULT_MODULE_ORDER, mergeModuleOrder, type ModuleId } from './modules'

describe('mergeModuleOrder', () => {
  it('leaves an order that already has every module untouched', () => {
    expect(mergeModuleOrder([...DEFAULT_MODULE_ORDER])).toEqual([...DEFAULT_MODULE_ORDER])
  })

  it('returns the defaults when nothing has been saved yet', () => {
    expect(mergeModuleOrder([])).toEqual([...DEFAULT_MODULE_ORDER])
  })

  it('restores a missing module next to its default neighbour rather than appending', () => {
    const defaults = ['a', 'b', 'c', 'settings'] as unknown as ModuleId[]
    const saved = ['a', 'c', 'settings'] as unknown as ModuleId[]

    expect(mergeModuleOrder(saved, defaults)).toEqual(['a', 'b', 'c', 'settings'])
  })

  it('follows the section the user moved rather than the default position', () => {
    const defaults = ['a', 'b', 'new', 'c'] as unknown as ModuleId[]
    const saved = ['c', 'b', 'a'] as unknown as ModuleId[]

    // 'new' sits after 'b' in the defaults, so it follows 'b' to its new home.
    expect(mergeModuleOrder(saved, defaults)).toEqual(['c', 'b', 'new', 'a'])
  })

  it('keeps consecutive new modules in their default relative order', () => {
    const defaults = ['a', 'x', 'y', 'z', 'b'] as unknown as ModuleId[]
    const saved = ['a', 'b'] as unknown as ModuleId[]

    expect(mergeModuleOrder(saved, defaults)).toEqual(['a', 'x', 'y', 'z', 'b'])
  })

  it('anchors forwards when nothing before the new module is present', () => {
    const defaults = ['a', 'b', 'c'] as unknown as ModuleId[]
    const saved = ['c'] as unknown as ModuleId[]

    expect(mergeModuleOrder(saved, defaults)).toEqual(['a', 'b', 'c'])
  })

  it('preserves entries that are no longer in the defaults', () => {
    const defaults = ['a', 'b'] as unknown as ModuleId[]
    const saved = ['a', 'retired'] as unknown as ModuleId[]

    expect(mergeModuleOrder(saved, defaults)).toContain('retired')
  })

  it('places Customers above Settings for an order saved before it existed', () => {
    const saved = DEFAULT_MODULE_ORDER.filter((id) => id !== 'customers')

    const merged = mergeModuleOrder(saved)

    expect(merged.indexOf('customers')).toBeGreaterThanOrEqual(0)
    expect(merged.indexOf('customers')).toBeLessThan(merged.indexOf('settings'))
    expect(merged).toEqual([...DEFAULT_MODULE_ORDER])
  })
})
