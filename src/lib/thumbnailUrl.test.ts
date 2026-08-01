import { describe, expect, it } from 'vitest'

import { buildThumbnailUrl, supportsThumbnail, type ThumbnailSource } from './thumbnailUrl'

function source(overrides: Partial<ThumbnailSource> = {}): ThumbnailSource {
  return {
    path: 'C:\\vault\\bracket.SLDPRT',
    extension: '.SLDPRT',
    isDirectory: false,
    size: 2048,
    modifiedTime: '2026-07-31T12:00:00.000Z',
    ...overrides,
  }
}

describe('supportsThumbnail', () => {
  it('accepts SolidWorks files regardless of extension casing', () => {
    expect(supportsThumbnail(source())).toBe(true)
    expect(supportsThumbnail(source({ extension: '.sldasm' }))).toBe(true)
  })

  it('rejects directories, unsupported types and files with no path', () => {
    expect(supportsThumbnail(source({ isDirectory: true }))).toBe(false)
    expect(supportsThumbnail(source({ extension: '.txt' }))).toBe(false)
    expect(supportsThumbnail(source({ path: undefined }))).toBe(false)
  })
})

describe('buildThumbnailUrl', () => {
  it('returns null for files that cannot have a thumbnail', () => {
    expect(buildThumbnailUrl(source({ extension: '.pdf' }), 'grid')).toBeNull()
    expect(buildThumbnailUrl(source({ isDirectory: true }), 'grid')).toBeNull()
  })

  it('encodes the tier, path and a version derived from mtime and size', () => {
    const url = new URL(buildThumbnailUrl(source(), 'grid') as string)

    expect(url.protocol).toBe('blueplm-thumb:')
    expect(url.searchParams.get('tier')).toBe('grid')
    expect(url.searchParams.get('p')).toBe('C:\\vault\\bracket.SLDPRT')
    expect(url.searchParams.get('v')).toBe(`${Date.parse('2026-07-31T12:00:00.000Z')}-2048`)
  })

  it('changes the version when the file changes, so the browser refetches', () => {
    const before = buildThumbnailUrl(source(), 'grid')
    const afterEdit = buildThumbnailUrl(
      source({ modifiedTime: '2026-07-31T13:00:00.000Z', size: 4096 }),
      'grid',
    )

    expect(afterEdit).not.toBe(before)
  })

  it('keeps tiers on separate URLs', () => {
    expect(buildThumbnailUrl(source(), 'grid')).not.toBe(buildThumbnailUrl(source(), 'preview'))
  })

  it('prefers an explicit version over mtime and size', () => {
    const url = new URL(buildThumbnailUrl(source(), 'grid', { version: 'rev-7' }) as string)
    expect(url.searchParams.get('v')).toBe('rev-7')
  })

  it('falls back to a stable session version when metadata is unavailable', () => {
    const bare = source({ size: undefined, modifiedTime: undefined })

    const first = buildThumbnailUrl(bare, 'grid')
    expect(first).toBe(buildThumbnailUrl(bare, 'grid'))
    expect(new URL(first as string).searchParams.get('v')).toMatch(/^s[0-9a-z]+$/)
  })

  it('passes through the configuration and marks refresh requests', () => {
    const url = new URL(
      buildThumbnailUrl(source(), 'preview', {
        configuration: 'Default<As Machined>',
        refreshToken: 1234,
      }) as string,
    )

    expect(url.searchParams.get('c')).toBe('Default<As Machined>')
    expect(url.searchParams.get('refresh')).toBe('1')
    expect(url.searchParams.get('r')).toBe('1234')
  })

  it('omits the refresh marker by default', () => {
    const url = new URL(buildThumbnailUrl(source(), 'grid') as string)
    expect(url.searchParams.get('refresh')).toBeNull()
  })
})
