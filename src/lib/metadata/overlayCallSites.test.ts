/**
 * Regression cover for the call sites whose precedence was reversed.
 *
 * Three sites read the committed value first and the pending edit second, so a user's uncommitted
 * renumber or retitle was silently ignored by the thing they were about to hand to someone else -
 * a PDF filename, a drawing title block, a CSV. They were invisible because
 * `updatePendingMetadata` also copies the pending value into `pdmData`, which makes both branches
 * return the same string. That copy is being removed next, which is what makes these live.
 *
 * The sites themselves are component and hook internals - the suite runs in `node` with no React
 * harness - so this file covers them two ways. Each scenario below reproduces one site's inputs and
 * asserts what the shared overlay now returns for them, and the source scan at the bottom asserts
 * that no file has gone back to deciding for itself.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  resolveConfigurationDescription,
  resolveConfigurationTab,
  resolveConfigurationTabs,
  resolveDescription,
  resolvePartNumber,
  resolvedText,
} from './overlay'
import type { MetadataOverlaySource } from './overlay'
import type { PDMFile } from '@/types/pdm'

function row(
  fields: Partial<Pick<PDMFile, 'part_number' | 'description' | 'revision'>> & {
    custom_properties?: unknown
  },
): PDMFile {
  return {
    part_number: null,
    description: null,
    revision: '',
    custom_properties: null,
    ...fields,
  } as PDMFile
}

/**
 * A file the user has renumbered and retitled in the datacard but not yet checked in. This is the
 * state all three reversed sites got wrong, and the state the `pdmData` copy currently disguises.
 */
const RENAMED_BUT_NOT_CHECKED_IN: MetadataOverlaySource = {
  pendingMetadata: { part_number: 'PN-NEW', description: 'New description' },
  pdmData: row({ part_number: 'PN-OLD', description: 'Old description' }),
}

describe('ExportActions - the drawing export path', () => {
  // Was: `drawing.pdmData?.part_number || drawing.pendingMetadata?.part_number || ''`.
  // A drawing exported after a renumber got the old number in both the PDF filename and the
  // title block, so the wrong number reached whoever the PDF was sent to.

  it('names the exported drawing from the pending renumber, not the committed number', () => {
    expect(resolvedText(resolvePartNumber(RENAMED_BUT_NOT_CHECKED_IN))).toBe('PN-NEW')
  })

  it('takes the drawing description from the pending retitle', () => {
    expect(resolvedText(resolveDescription(RENAMED_BUT_NOT_CHECKED_IN))).toBe('New description')
  })

  it('exports nothing rather than the old number when the user cleared it', () => {
    const cleared: MetadataOverlaySource = {
      pendingMetadata: { part_number: '' },
      pdmData: row({ part_number: 'PN-OLD' }),
    }
    expect(resolvedText(resolvePartNumber(cleared))).toBe('')
  })

  it('still falls back to the committed value when there is no pending edit', () => {
    expect(resolvedText(resolvePartNumber({ pdmData: row({ part_number: 'PN-OLD' }) }))).toBe(
      'PN-OLD',
    )
  })

  it('keeps every configuration tab when only one was edited', () => {
    // Was: `pendingMetadata?.config_tabs || custom_properties._config_tabs`. Pending holds only
    // the edited configurations, so choosing it dropped the rest and the export picked a tab off
    // a one-entry map.
    const tabs = resolveConfigurationTabs({
      pendingMetadata: { config_tabs: { 'AS568-014': '999' } },
      pdmData: row({ custom_properties: { _config_tabs: { Default: '001', 'AS568-014': '014' } } }),
    })

    expect(tabs['Default']).toBe('001')
    expect(tabs['AS568-014']).toBe('999')
  })
})

describe('useConfigHandlers - the configuration export path', () => {
  // Was: `file?.pdmData?.part_number || file?.pendingMetadata?.part_number || ''` for the base
  // number, and `configDescription || file?.pdmData?.description || file?.pendingMetadata?.description`
  // for the description. Exporting a configuration after a renumber built the full item number
  // from the committed base, so the tab was appended to the wrong root.

  it('builds the configuration item number from the pending base number', () => {
    expect(resolvedText(resolvePartNumber(RENAMED_BUT_NOT_CHECKED_IN))).toBe('PN-NEW')
  })

  it('falls back to the pending file-level description, not the committed one', () => {
    const file: MetadataOverlaySource = {
      pendingMetadata: { description: 'New description' },
      pdmData: row({ description: 'Old description' }),
    }
    const configDescription = resolveConfigurationDescription(file, 'Default').value

    expect(configDescription).toBeNull()
    expect(configDescription || resolvedText(resolveDescription(file))).toBe('New description')
  })

  it('prefers a configuration-specific description over the file-level one', () => {
    const file: MetadataOverlaySource = {
      pendingMetadata: { description: 'file level', config_descriptions: { Default: 'config' } },
      pdmData: row({ description: 'Old description' }),
    }
    expect(resolveConfigurationDescription(file, 'Default').value).toBe('config')
  })

  it('takes a configuration tab the user edited over the committed one', () => {
    const file: MetadataOverlaySource = {
      pendingMetadata: { config_tabs: { Default: '900' } },
      pdmData: row({ custom_properties: { _config_tabs: { Default: '001' } } }),
    }
    expect(resolveConfigurationTab(file, 'Default').value).toBe('900')
  })
})

describe('ExportMetadataTableActions - the BR number column', () => {
  // Was: `file.pdmData?.part_number || file.pendingMetadata?.part_number || ''`. The metadata
  // table is a deliverable, so a stale BR number here leaves the building.

  it('writes the pending BR number into the exported table', () => {
    expect(resolvedText(resolvePartNumber(RENAMED_BUT_NOT_CHECKED_IN))).toBe('PN-NEW')
  })

  it('writes the pending description into the exported table', () => {
    expect(resolvedText(resolveDescription(RENAMED_BUT_NOT_CHECKED_IN))).toBe('New description')
  })
})

describe('no call site decides the overlay for itself', () => {
  const SOURCE_ROOT = join(__dirname, '..', '..')

  /** The overlay is where the rule lives, and its tests quote the shapes they replaced. */
  const EXEMPT = new Set(
    ['lib/metadata/overlay.ts', 'lib/metadata/overlayCallSites.test.ts'].map((path) =>
      path.split('/').join(sep),
    ),
  )

  function sourceFiles(directory: string): string[] {
    const found: string[] = []
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry)
      if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
      else if (/\.tsx?$/.test(entry)) found.push(path)
    }
    return found
  }

  const files = sourceFiles(SOURCE_ROOT)
    .map((path) => ({ path: relative(SOURCE_ROOT, path), text: readFileSync(path, 'utf8') }))
    .filter((file) => !EXEMPT.has(file.path))

  it('finds source to scan, so a broken scan cannot pass by finding nothing', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('reads no committed metadata field ahead of its pending edit', () => {
    // The reversed shape, across line breaks: a committed field, then `||`, then pending.
    const reversed =
      /pdmData(!|\?)?\.(part_number|description|revision)\s*\|\|[^;\n]{0,120}?pendingMetadata/

    const offenders = files
      .filter((file) => reversed.test(file.text.replace(/\s*\n\s*/g, ' ')))
      .map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('chooses no pending configuration map over the committed one instead of merging', () => {
    const replaced = /pendingMetadata(!|\?)?\.config_(tabs|descriptions)\s*\|\|/

    const offenders = files
      .filter((file) => replaced.test(file.text.replace(/\s*\n\s*/g, ' ')))
      .map((file) => file.path)

    // `useConfigHandlers` builds the *pending* map to store, where merging the committed values in
    // would defeat `dropCommittedPendingMetadata` and mark every file as needing check-in forever.
    expect(offenders).toEqual([
      join('features', 'source', 'browser', 'hooks', 'useConfigHandlers.ts'),
    ])
  })
})
