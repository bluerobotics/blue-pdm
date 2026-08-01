import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ThumbnailManifest, type ManifestEntry } from './manifest'

const noop = () => {}

function entry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    sourcePath: 'C:/vault/part.sldprt',
    bytes: 1000,
    lastAccess: 1,
    negative: false,
    ext: 'png',
    ...overrides,
  }
}

describe('ThumbnailManifest', () => {
  let cacheRoot: string

  beforeEach(async () => {
    cacheRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'blueplm-thumbnails-'))
  })

  afterEach(async () => {
    await fs.promises.rm(cacheRoot, { recursive: true, force: true })
  })

  it('tracks total bytes as entries are added, replaced and removed', () => {
    const manifest = new ThumbnailManifest(cacheRoot, noop)

    manifest.set('aa', entry({ bytes: 1000 }))
    manifest.set('bb', entry({ bytes: 500 }))
    expect(manifest.bytes).toBe(1500)
    expect(manifest.size).toBe(2)

    // Replacing an entry must not double-count the old size.
    manifest.set('aa', entry({ bytes: 250 }))
    expect(manifest.bytes).toBe(750)

    manifest.delete('bb')
    expect(manifest.bytes).toBe(250)
    expect(manifest.size).toBe(1)

    manifest.dispose()
  })

  it('round-trips entries through disk', async () => {
    const written = new ThumbnailManifest(cacheRoot, noop)
    written.set('aa', entry({ bytes: 120, lastAccess: 42, sourcePath: 'C:/vault/a.sldprt' }))
    written.set('bb', entry({ bytes: 0, negative: true, ext: '' }))
    await written.flush()
    written.dispose()

    const loaded = new ThumbnailManifest(cacheRoot, noop)
    expect(await loaded.load()).toBe(true)

    expect(loaded.get('aa')).toEqual({
      sourcePath: 'C:/vault/a.sldprt',
      bytes: 120,
      lastAccess: 42,
      negative: false,
      ext: 'png',
    })
    expect(loaded.get('bb')?.negative).toBe(true)
    expect(loaded.bytes).toBe(120)

    loaded.dispose()
  })

  it('reports failure rather than throwing when the index is missing or corrupt', async () => {
    const missing = new ThumbnailManifest(cacheRoot, noop)
    expect(await missing.load()).toBe(false)
    missing.dispose()

    await fs.promises.writeFile(path.join(cacheRoot, 'manifest.json'), '{not json', 'utf-8')

    const corrupt = new ThumbnailManifest(cacheRoot, noop)
    expect(await corrupt.load()).toBe(false)
    corrupt.dispose()
  })

  it('rebuilds the index by scanning shard directories', async () => {
    const shard = path.join(cacheRoot, 'ab')
    await fs.promises.mkdir(shard, { recursive: true })
    await fs.promises.writeFile(path.join(shard, 'abcdef.png'), Buffer.alloc(64))
    await fs.promises.writeFile(path.join(shard, 'abbbbb.none'), '')

    const manifest = new ThumbnailManifest(cacheRoot, noop)
    await manifest.rebuildFromDisk()

    expect(manifest.size).toBe(2)
    expect(manifest.get('abcdef')).toMatchObject({ bytes: 64, negative: false, ext: 'png' })
    // Negative markers must survive a rebuild, otherwise files with no preview
    // would be re-extracted on every launch.
    expect(manifest.get('abbbbb')).toMatchObject({ bytes: 0, negative: true })
    expect(manifest.bytes).toBe(64)

    manifest.dispose()
  })

  it('orders entries oldest access first for eviction', () => {
    const manifest = new ThumbnailManifest(cacheRoot, noop)
    manifest.set('newest', entry({ lastAccess: 300 }))
    manifest.set('oldest', entry({ lastAccess: 100 }))
    manifest.set('middle', entry({ lastAccess: 200 }))

    expect(manifest.entriesByAge().map(([hash]) => hash)).toEqual(['oldest', 'middle', 'newest'])

    manifest.dispose()
  })
})
