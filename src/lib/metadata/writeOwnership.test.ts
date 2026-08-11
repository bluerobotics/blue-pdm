import { describe, expect, it } from 'vitest'

import { usePDMStore } from '@/stores/pdmStore'

import {
  currentUnwritableFieldGroups,
  unwritableFieldGroups,
  WRITABLE_DOCUMENT_EXTENSIONS,
} from './writeOwnership'
import type { DrawingLockoutSettings } from './drawingLockouts'
import type { MetadataFieldGroup } from './writeState'

const ALL_LOCKED: DrawingLockoutSettings = {
  lockDrawingItemNumber: true,
  lockDrawingDescription: true,
  lockDrawingRevision: true,
}

const NONE_LOCKED: DrawingLockoutSettings = {
  lockDrawingItemNumber: false,
  lockDrawingDescription: false,
  lockDrawingRevision: false,
}

const ALL_GROUPS: readonly MetadataFieldGroup[] = [
  'description',
  'part_number',
  'revision',
  'tab_number',
]

function sortedGroups(groups: ReadonlySet<MetadataFieldGroup>): MetadataFieldGroup[] {
  return [...groups].sort()
}

describe('write ownership', () => {
  it('publishes the canonical SolidWorks document extensions', () => {
    expect(WRITABLE_DOCUMENT_EXTENSIONS).toEqual(['.sldprt', '.sldasm', '.slddrw'])
  })

  it.each(['.pdf', '.dxf', '.step', '.txt'])('marks every group unwritable for %s', (extension) => {
    expect(sortedGroups(unwritableFieldGroups(extension, NONE_LOCKED))).toEqual([...ALL_GROUPS])
  })

  it('marks every group unwritable when the extension is absent', () => {
    expect(sortedGroups(unwritableFieldGroups(undefined, NONE_LOCKED))).toEqual([...ALL_GROUPS])
  })

  it.each(['.sldprt', '.sldasm'])(
    'marks no group unwritable for %s even when every drawing lock is on',
    (extension) => {
      expect(unwritableFieldGroups(extension, ALL_LOCKED).size).toBe(0)
    },
  )

  it('always excludes revision from a drawing', () => {
    expect(sortedGroups(unwritableFieldGroups('.slddrw', NONE_LOCKED))).toEqual(['revision'])
  })

  it('keeps the drawing item number and tab number coupled', () => {
    const itemNumberLocked = unwritableFieldGroups('.slddrw', {
      ...NONE_LOCKED,
      lockDrawingItemNumber: true,
    })

    expect(sortedGroups(itemNumberLocked)).toEqual(['part_number', 'revision', 'tab_number'])
    expect(itemNumberLocked.has('part_number')).toBe(itemNumberLocked.has('tab_number'))
  })

  it('uses the description lock for drawing descriptions', () => {
    const descriptionLocked = unwritableFieldGroups('.slddrw', {
      ...NONE_LOCKED,
      lockDrawingDescription: true,
    })

    expect(sortedGroups(descriptionLocked)).toEqual(['description', 'revision'])
  })

  it('matches drawing extensions case-insensitively', () => {
    expect(sortedGroups(unwritableFieldGroups('.SLDDRW', NONE_LOCKED))).toEqual(
      sortedGroups(unwritableFieldGroups('.slddrw', NONE_LOCKED)),
    )
  })

  it('reads the current drawing lock settings for the current variant', () => {
    const current = usePDMStore.getState()
    const previous = {
      lockDrawingItemNumber: current.lockDrawingItemNumber,
      lockDrawingDescription: current.lockDrawingDescription,
      lockDrawingRevision: current.lockDrawingRevision,
    }

    usePDMStore.setState({
      lockDrawingItemNumber: true,
      lockDrawingDescription: false,
      lockDrawingRevision: false,
    })

    try {
      expect(sortedGroups(currentUnwritableFieldGroups('.slddrw'))).toEqual([
        'part_number',
        'revision',
        'tab_number',
      ])
    } finally {
      usePDMStore.setState(previous)
    }
  })
})
