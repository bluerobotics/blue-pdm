import type { SWReference } from '@/lib/supabase/files/mutations'

import { normalizePath } from './pathMatching'
import type { SWServiceReference } from './types'

const DEFAULT_REFERENCE_QUANTITY = 1

function isNamedConfiguration(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Return the configurations represented by one SolidWorks reference.
 *
 * Document Manager groups drawing views by child path and exposes every configuration in
 * `configurations`. Older service responses only expose `configuration`, while a reference with
 * no named configuration must still produce a row so an upsert can replace the complete set.
 */
function getReferenceConfigurations(ref: SWServiceReference): Array<string | undefined> {
  const configurations = Array.isArray(ref.configurations)
    ? ref.configurations.filter(isNamedConfiguration)
    : []

  if (configurations.length > 0) {
    return Array.from(new Set(configurations))
  }

  if (isNamedConfiguration(ref.configuration)) {
    return [ref.configuration]
  }

  return [undefined]
}

/**
 * Convert SolidWorks references into database reference rows.
 *
 * A drawing can contain views of multiple configurations of the same model. The database's
 * uniqueness key is `(child, configuration)`, so each pair must be represented independently.
 */
export function swRefsToFileReferences(swRefs: SWServiceReference[]): SWReference[] {
  const references: SWReference[] = []
  const seenPairs = new Set<string>()

  for (const swRef of swRefs) {
    for (const configuration of getReferenceConfigurations(swRef)) {
      const pairKey = JSON.stringify([normalizePath(swRef.path), configuration ?? null])
      if (seenPairs.has(pairKey)) continue

      seenPairs.add(pairKey)
      references.push({
        childFilePath: swRef.path,
        quantity: DEFAULT_REFERENCE_QUANTITY,
        referenceType: 'reference',
        configuration,
      })
    }
  }

  return references
}
