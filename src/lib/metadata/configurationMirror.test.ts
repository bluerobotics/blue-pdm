import { describe, expect, it } from 'vitest'

import { propertiesToMirror } from './configurationMirror'

const FILE_SCOPE = { Description: 'O-ring, Viton', Number: 'BR-202020', Revision: 'B' }

describe('copying a file-scope value into a configuration', () => {
  it('fills a property the configuration does not have', () => {
    expect(propertiesToMirror(FILE_SCOPE, {})).toEqual(FILE_SCOPE)
  })

  it('leaves a configuration’s own value alone', () => {
    const mirrored = propertiesToMirror(FILE_SCOPE, { Description: 'O-ring, Viton, 014' })

    expect(mirrored).toEqual({ Number: 'BR-202020', Revision: 'B' })
  })

  it('keeps a configuration description the user deliberately cleared', () => {
    // The mirror tested truthiness, so an empty configuration description read as absent and was
    // refilled from file level - collapsing the one distinction the empty write exists to express.
    // Clearing the file-level Description is not a request to restamp 68 configurations.
    const mirrored = propertiesToMirror(FILE_SCOPE, { Description: '' })

    expect(mirrored).not.toHaveProperty('Description')
    expect(mirrored).toEqual({ Number: 'BR-202020', Revision: 'B' })
  })

  it('keeps a value that is only whitespace, because the configuration still holds one', () => {
    const mirrored = propertiesToMirror(FILE_SCOPE, { Revision: '  ' })

    expect(mirrored).not.toHaveProperty('Revision')
  })

  it('replaces a property reference, which holds no value of its own', () => {
    const mirrored = propertiesToMirror(FILE_SCOPE, {
      Description: '$PRP:"Description"',
      Number: 'SW-PRP:"SW-File Name"',
    })

    expect(mirrored).toMatchObject({ Description: 'O-ring, Viton', Number: 'BR-202020' })
  })

  it('writes nothing when every field is the configuration’s own', () => {
    const mirrored = propertiesToMirror(FILE_SCOPE, {
      Description: '',
      Number: 'BR-202020-014',
      Revision: 'A',
    })

    expect(mirrored).toEqual({})
  })
})
