/**
 * Which metadata field groups BluePLM will never write into a document.
 *
 * This is deliberately separate from `drawingLockouts.ts`. The lockout module answers the
 * editability question - "may the user type in this field?" - while this module answers the write
 * ownership question - "will BluePLM ever put this field into this document?" A drawing can be
 * editable in a column that BluePLM still never writes, and a non-SolidWorks file cannot be written
 * regardless of which drawing settings are enabled.
 *
 * `WRITABLE_DOCUMENT_EXTENSIONS` is the canonical list for write ownership. Other write-related
 * extension lists elsewhere in the codebase describe their own concerns and should not be
 * consolidated with this one.
 */

import { usePDMStore } from '@/stores/pdmStore'

import { lockedDrawingFields, type DrawingLockoutSettings } from './drawingLockouts'
import type { MetadataFieldGroup } from './writeState'

/** The only document extensions targeted by a BluePLM metadata write path. */
export const WRITABLE_DOCUMENT_EXTENSIONS: readonly string[] = ['.sldprt', '.sldasm', '.slddrw']

const DRAWING_EXTENSION = '.slddrw'

const ALL_METADATA_FIELD_GROUPS: readonly MetadataFieldGroup[] = [
  'part_number',
  'tab_number',
  'description',
  'revision',
]

/**
 * Which field groups this document can never receive from BluePLM.
 *
 * A non-SolidWorks file has no metadata write path at all, so every group is unwritable. Parts and
 * assemblies have no ownership exclusions. Drawings always exclude revision because the drawing's
 * own revision table is authoritative and no write path pushes a revision into the drawing; the
 * item-number and description exclusions follow the same lock-to-field mapping as
 * `lockedDrawingFields`.
 */
export function unwritableFieldGroups(
  extension: string | undefined,
  settings: DrawingLockoutSettings,
): ReadonlySet<MetadataFieldGroup> {
  const normalizedExtension = extension?.toLowerCase()

  if (
    normalizedExtension === undefined ||
    !WRITABLE_DOCUMENT_EXTENSIONS.includes(normalizedExtension)
  ) {
    return new Set(ALL_METADATA_FIELD_GROUPS)
  }

  if (normalizedExtension !== DRAWING_EXTENSION) return new Set()

  const lockedFields = lockedDrawingFields(normalizedExtension, settings)
  const unwritable = new Set<MetadataFieldGroup>(['revision'])

  if (lockedFields.has('part_number')) {
    unwritable.add('part_number')
    unwritable.add('tab_number')
  }
  if (lockedFields.has('description')) unwritable.add('description')

  return unwritable
}

/** `unwritableFieldGroups` against the drawing settings currently held by the store. */
export function currentUnwritableFieldGroups(
  extension: string | undefined,
): ReadonlySet<MetadataFieldGroup> {
  const { lockDrawingItemNumber, lockDrawingDescription, lockDrawingRevision } =
    usePDMStore.getState()

  return unwritableFieldGroups(extension, {
    lockDrawingItemNumber,
    lockDrawingDescription,
    lockDrawingRevision,
  })
}
