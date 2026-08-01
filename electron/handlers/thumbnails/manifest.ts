/**
 * In-memory index of the thumbnail cache, persisted to a JSON file.
 *
 * The index is authoritative at runtime: it records which extension each entry
 * was stored under, so the read path never has to probe the filesystem for
 * candidate filenames. The JSON file is only a way to carry that index across
 * restarts, and can always be rebuilt by scanning the cache directory, so a
 * missing or corrupt file is never fatal.
 */

import fs from 'fs'
import path from 'path'

/** Bumped when the on-disk index shape changes in a way older code cannot read. */
const MANIFEST_VERSION = 1

/** Quiet period after the last mutation before the index is written out. */
const FLUSH_DEBOUNCE_MS = 5_000

const MANIFEST_FILENAME = 'manifest.json'

export interface ManifestEntry {
  /** Source file this image came from. Diagnostic only; never used for lookup. */
  sourcePath: string
  /** Size of the stored image on disk. Zero for negative entries. */
  bytes: number
  lastAccess: number
  /** True when the source file has no extractable image. */
  negative: boolean
  /** Extension the image was stored under, without a leading dot. */
  ext: string
}

interface SerializedEntry {
  p: string
  b: number
  a: number
  n: 0 | 1
  e: string
}

interface SerializedManifest {
  version: number
  entries: Record<string, SerializedEntry>
}

type Logger = (message: string, data?: unknown) => void

export class ThumbnailManifest {
  private readonly entries = new Map<string, ManifestEntry>()
  private readonly cacheRoot: string
  private readonly manifestPath: string
  private readonly logError: Logger
  private flushTimer: NodeJS.Timeout | null = null
  private dirty = false
  private totalBytes = 0

  constructor(cacheRoot: string, logError: Logger) {
    this.cacheRoot = cacheRoot
    this.manifestPath = path.join(cacheRoot, MANIFEST_FILENAME)
    this.logError = logError
  }

  get size(): number {
    return this.entries.size
  }

  get bytes(): number {
    return this.totalBytes
  }

  get(hash: string): ManifestEntry | undefined {
    return this.entries.get(hash)
  }

  set(hash: string, entry: ManifestEntry): void {
    const existing = this.entries.get(hash)
    if (existing) this.totalBytes -= existing.bytes
    this.entries.set(hash, entry)
    this.totalBytes += entry.bytes
    this.markDirty()
  }

  delete(hash: string): void {
    const existing = this.entries.get(hash)
    if (!existing) return
    this.totalBytes -= existing.bytes
    this.entries.delete(hash)
    this.markDirty()
  }

  /**
   * Record that an entry was used.
   *
   * Deliberately does not mark the index dirty: access times only steer
   * eviction, and persisting them would turn every cache hit into a pending
   * disk write. They are saved along with the next real mutation.
   */
  touch(hash: string): void {
    const existing = this.entries.get(hash)
    if (existing) existing.lastAccess = Date.now()
  }

  /** Entries ordered oldest-access first, for eviction. */
  entriesByAge(): Array<[string, ManifestEntry]> {
    return Array.from(this.entries.entries()).sort((a, b) => a[1].lastAccess - b[1].lastAccess)
  }

  /** Returns false when the index could not be read and must be rebuilt. */
  async load(): Promise<boolean> {
    try {
      const raw = await fs.promises.readFile(this.manifestPath, 'utf-8')
      const parsed = JSON.parse(raw) as SerializedManifest

      if (parsed.version !== MANIFEST_VERSION || typeof parsed.entries !== 'object') {
        return false
      }

      this.entries.clear()
      this.totalBytes = 0

      for (const [hash, entry] of Object.entries(parsed.entries)) {
        this.entries.set(hash, {
          sourcePath: entry.p,
          bytes: entry.b,
          lastAccess: entry.a,
          negative: entry.n === 1,
          ext: entry.e,
        })
        this.totalBytes += entry.b
      }

      return true
    } catch {
      // Absent on first run, and unreadable if a previous write was interrupted.
      // Either way the caller rebuilds from the cache directory.
      return false
    }
  }

  /**
   * Rebuild the index by scanning the shard directories.
   *
   * Source paths are unrecoverable this way, but they are diagnostic only;
   * everything the read and eviction paths need is in the filenames and stats.
   */
  async rebuildFromDisk(): Promise<void> {
    this.entries.clear()
    this.totalBytes = 0

    let shards: string[]
    try {
      shards = await fs.promises.readdir(this.cacheRoot)
    } catch {
      return
    }

    for (const shard of shards) {
      const shardPath = path.join(this.cacheRoot, shard)

      let files: string[]
      try {
        const shardStat = await fs.promises.stat(shardPath)
        if (!shardStat.isDirectory()) continue
        files = await fs.promises.readdir(shardPath)
      } catch {
        continue
      }

      for (const file of files) {
        const ext = path.extname(file).slice(1)
        const hash = path.basename(file, path.extname(file))
        if (!hash) continue

        try {
          const stat = await fs.promises.stat(path.join(shardPath, file))
          const negative = ext === 'none'
          const bytes = negative ? 0 : stat.size

          this.entries.set(hash, {
            sourcePath: '',
            bytes,
            lastAccess: stat.mtimeMs,
            negative,
            ext: negative ? '' : ext,
          })
          this.totalBytes += bytes
        } catch {
          // Raced with eviction or an external delete; skip it.
        }
      }
    }

    this.markDirty()
  }

  private markDirty(): void {
    this.dirty = true
    if (this.flushTimer) return

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, FLUSH_DEBOUNCE_MS)

    // A pending index write must never hold the process open at quit.
    this.flushTimer.unref?.()
  }

  /** Write the index out now. Safe to call when nothing has changed. */
  async flush(): Promise<void> {
    if (!this.dirty) return
    this.dirty = false

    const serialized: SerializedManifest = { version: MANIFEST_VERSION, entries: {} }
    for (const [hash, entry] of this.entries) {
      serialized.entries[hash] = {
        p: entry.sourcePath,
        b: entry.bytes,
        a: entry.lastAccess,
        n: entry.negative ? 1 : 0,
        e: entry.ext,
      }
    }

    const tempPath = `${this.manifestPath}.tmp`
    try {
      await fs.promises.writeFile(tempPath, JSON.stringify(serialized), 'utf-8')
      await fs.promises.rename(tempPath, this.manifestPath)
    } catch (error) {
      // Leave the index marked dirty so the next mutation retries the write.
      this.dirty = true
      this.logError('[ThumbnailCache] Failed to write manifest', { error: String(error) })
      await fs.promises.rm(tempPath, { force: true }).catch(() => undefined)
    }
  }

  dispose(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }
}
