/**
 * Reading a part or assembly's configurations into the rows the tree shows.
 *
 * Split out of `useConfigHandlers`, which is past the size at which the workspace rules require a
 * split before new functionality lands.
 *
 * BluePLM's values come first - the committed configuration maps with the user's edits overlaid -
 * and the document is only read for the configurations BluePLM has nothing to say about. That read
 * is one call per such configuration, which is why it is skipped entirely once both fields are
 * known.
 */

import { log } from '@/lib/logger'
import { resolvedConfigurationProperties } from '@/lib/metadata/divergence'
import { resolveConfigurationDescriptions, resolveConfigurationTabs } from '@/lib/metadata/overlay'
import type { LocalFile } from '@/stores/pdmStore'

import type { ConfigWithDepth } from '../types'
import { buildConfigTreeFlat } from '../utils/configTree'

interface SwConfiguration {
  name: string
  isActive?: boolean
  parentConfiguration?: string | null
  properties?: Record<string, string>
}

/** Pull a tab out of a configuration's `Number`, for documents that carry no `Tab Number`. */
function tabFromNumber(properties: Record<string, string>): string {
  const number = properties['Number'] || properties['Part Number'] || properties['PartNumber'] || ''
  const parts = number.split('-')
  if (parts.length < 2) return ''

  const last = parts[parts.length - 1]
  // A trailing segment long enough to be a number in its own right is the number, not a tab.
  return last && last.length <= 4 ? last : ''
}

async function readFromDocument(
  filePath: string,
  configuration: string,
): Promise<{ description: string; tabNumber: string }> {
  try {
    const result = await window.electronAPI?.solidworks?.getProperties(filePath, configuration)
    if (!result?.success || !result.data) return { description: '', tabNumber: '' }

    // The resolved view, deliberately: this is a display reader, and what a row should show is
    // what SolidWorks resolves in the configuration's context. Through the shared helper rather
    // than spread by hand, so the display view and the write-verification view cannot drift.
    const properties = resolvedConfigurationProperties(
      {
        configurations: result.data.configurations ?? [],
        fileProperties: result.data.fileProperties ?? {},
        configurationProperties: result.data.configurationProperties ?? {},
      },
      configuration,
    )

    return {
      description:
        properties['Description'] || properties['DESCRIPTION'] || properties['description'] || '',
      tabNumber: tabFromNumber(properties),
    }
  } catch (error) {
    log.error('[ConfigHandlers]', `Failed to load properties for config ${configuration}`, {
      error,
    })
    return { description: '', tabNumber: '' }
  }
}

/**
 * Load a document's configurations as tree rows, or null when they could not be read.
 */
export async function loadFileConfigurations(file: LocalFile): Promise<ConfigWithDepth[] | null> {
  let configurations: SwConfiguration[]
  try {
    const result = await window.electronAPI?.solidworks?.getConfigurations(file.path)
    if (!result?.success || !result.data?.configurations) return null
    configurations = result.data.configurations as SwConfiguration[]
  } catch (error) {
    log.error('[ConfigHandlers]', 'Failed to load configurations', { error })
    return null
  }

  const tabs = resolveConfigurationTabs(file)
  const descriptions = resolveConfigurationDescriptions(file)

  const rows = await Promise.all(
    configurations.map(async (configuration) => {
      let tabNumber = tabs[configuration.name] || ''
      let description = descriptions[configuration.name] || ''

      if (!tabNumber || !description) {
        const fromDocument = await readFromDocument(file.path, configuration.name)
        if (!description) description = fromDocument.description
        if (!tabNumber) tabNumber = fromDocument.tabNumber
      }

      return {
        name: configuration.name,
        isActive: configuration.isActive,
        parentConfiguration: configuration.parentConfiguration,
        tabNumber,
        description,
        depth: 0, // Set by buildConfigTreeFlat
      }
    }),
  )

  return buildConfigTreeFlat(rows)
}
