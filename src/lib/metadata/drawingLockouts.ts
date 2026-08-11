/**
 * Which fields of a drawing BluePLM may write, and which belong to the model it documents.
 *
 * A drawing takes its item number, description and revision from the part or assembly it
 * references, so BluePLM is not the source of truth for them. Three per-user settings say so, all
 * on by default, and the file list, the file grid and the inline edit handlers have honoured them
 * for as long as they have existed: the cells are read-only and the edit handler refuses with
 * "Drawing item number is inherited from the referenced model".
 *
 * The write paths did not. The SolidWorks panel's "Write to File" button and the datacard's
 * post-edit write both pushed BluePLM's values straight into a `.slddrw`, which is the same
 * mutation the read-only cell exists to prevent - only reached from a different button. A drawing
 * whose number was overwritten that way then disagrees with its parent, and `pullDrawingMetadata`
 * reads the disagreement back as drift on the next sync.
 *
 * So the rule lives here rather than in either caller, and both ask it the same question. The way
 * a locked field reaches a drawing is `syncMetadataPush.pushDrawingMetadata`, which writes the
 * parent's own properties verbatim rather than anything BluePLM composed.
 *
 * This module answers whether a user may edit a drawing field. The separate question of whether
 * BluePLM will ever write a field into a document, including non-SolidWorks files and drawing
 * revision, is answered by `writeOwnership.ts`.
 *
 * Revision is listed for completeness and is never written to a drawing by any path: the drawing's
 * own revision table is authoritative, which is why `pushDrawingMetadata` omits it outright.
 */

import { usePDMStore } from '@/stores/pdmStore'

const DRAWING_EXTENSION = '.slddrw'

/** The drawing fields a user can mark as inherited from the referenced model. */
export type LockableDrawingField = 'part_number' | 'description' | 'revision'

export interface DrawingLockoutSettings {
  lockDrawingItemNumber: boolean
  lockDrawingDescription: boolean
  lockDrawingRevision: boolean
}

const NOTHING_LOCKED: ReadonlySet<LockableDrawingField> = new Set()

/**
 * The fields this file's extension and the user's settings put out of BluePLM's reach.
 *
 * Empty for anything that is not a drawing, so a caller can apply the result unconditionally
 * rather than testing the extension itself and getting the comparison subtly wrong.
 */
export function lockedDrawingFields(
  extension: string | undefined,
  settings: DrawingLockoutSettings,
): ReadonlySet<LockableDrawingField> {
  if ((extension ?? '').toLowerCase() !== DRAWING_EXTENSION) return NOTHING_LOCKED

  const locked = new Set<LockableDrawingField>()
  if (settings.lockDrawingItemNumber) locked.add('part_number')
  if (settings.lockDrawingDescription) locked.add('description')
  if (settings.lockDrawingRevision) locked.add('revision')
  return locked
}

/** `lockedDrawingFields` against the settings as they stand now. */
export function currentLockedDrawingFields(
  extension: string | undefined,
): ReadonlySet<LockableDrawingField> {
  const { lockDrawingItemNumber, lockDrawingDescription, lockDrawingRevision } =
    usePDMStore.getState()
  return lockedDrawingFields(extension, {
    lockDrawingItemNumber,
    lockDrawingDescription,
    lockDrawingRevision,
  })
}
