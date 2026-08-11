/**
 * Marks metadata that BluePLM has not confirmed in a document it can write.
 *
 * Sync Metadata is the command that writes BluePLM's values into a part or assembly. The marker
 * therefore names that command in the tooltip instead of offering a second per-cell retry action:
 * a retry icon in a 10px table cell duplicates the command and gives the write a confusing second
 * entry point.
 *
 * What it shows, in order of how much it should worry someone:
 *
 * - **failed** and **unattempted**: the value is definitely not in the file.
 * - **unverified**: the write was made but could not be confirmed.
 * - **pending**: edited, with no write attempted yet.
 * - **verified**: nothing at all. A confirmed value needs no decoration.
 *
 * One mark can only show one state, so the most alarming among the addresses it covers wins - see
 * `summarizeWriteState`. The configuration names come with it, because "not written" on a part with
 * 68 configurations is only actionable if it says which ones.
 *
 * A `field` narrows the mark to the column it sits in, so a failed configuration tab is flagged on
 * Tab Number rather than on all four datacard columns at once. Omitting it marks the file as a whole,
 * which is what a panel wants. Write ownership is filtered before either mode resolves its state,
 * including for marks persisted before this guard existed.
 */

import { AlertTriangle, Loader2 } from 'lucide-react'

import { t } from '@/lib/i18n'
import { unwritableFieldGroups } from '@/lib/metadata/writeOwnership'
import {
  needsWrite,
  pendingWithoutGroups,
  recordWithoutGroups,
  resolveFileWriteState,
  scopePendingToGroup,
  scopeRecordToGroup,
  summarizeWriteState,
  type MetadataFieldGroup,
  type MetadataWriteDisplayState,
} from '@/lib/metadata/writeState'
import { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile } from '@/stores/types'

const STATE_MESSAGE: Record<MetadataWriteDisplayState, string> = {
  pending: 'source.metadataWrite.statePending',
  writing: 'source.metadataWrite.stateWriting',
  verified: 'source.metadataWrite.stateVerified',
  unverified: 'source.metadataWrite.stateUnverified',
  failed: 'source.metadataWrite.stateFailed',
  unattempted: 'source.metadataWrite.stateUnattempted',
}

/** Red for "definitely not in the file", amber for "nobody knows", muted for "not yet". */
const STATE_CLASS: Record<MetadataWriteDisplayState, string> = {
  pending: 'text-plm-fg-muted',
  writing: 'text-plm-fg-muted',
  verified: 'text-plm-fg-muted',
  unverified: 'text-amber-500',
  failed: 'text-red-500',
  unattempted: 'text-red-500',
}

export interface MetadataWriteStateMarkerProps {
  file: LocalFile
  /** The column this mark sits in. Omitted marks every field the file has an outcome for. */
  field?: MetadataFieldGroup
  /**
   * True while a write for this file is in flight.
   *
   * The one state that is never recorded: it belongs to the caller that issued the write and to
   * nobody after it finishes, so it arrives as a prop rather than out of `file.metadataWriteState`.
   */
  isWriting?: boolean
}

export function MetadataWriteStateMarker({
  file,
  field,
  isWriting,
}: MetadataWriteStateMarkerProps): React.ReactNode {
  const lockDrawingItemNumber = usePDMStore((state) => state.lockDrawingItemNumber)
  const lockDrawingDescription = usePDMStore((state) => state.lockDrawingDescription)
  const lockDrawingRevision = usePDMStore((state) => state.lockDrawingRevision)
  const unwritableGroups = unwritableFieldGroups(file.extension, {
    lockDrawingItemNumber,
    lockDrawingDescription,
    lockDrawingRevision,
  })

  if (field && unwritableGroups.has(field)) return null

  const pending = field
    ? scopePendingToGroup(file.pendingMetadata, field)
    : pendingWithoutGroups(file.pendingMetadata, unwritableGroups)
  const record = field
    ? scopeRecordToGroup(file.metadataWriteState, field)
    : recordWithoutGroups(file.metadataWriteState, unwritableGroups)

  const state = isWriting && pending ? 'writing' : resolveFileWriteState(pending, record)

  // A confirmed value, or one with nothing recorded and nothing pending, says nothing.
  if (!state || state === 'verified') return null

  const summary = summarizeWriteState(record)
  const parts = [t(STATE_MESSAGE[state])]
  if (summary.affectedConfigurations.length > 0) {
    parts.push(
      t('source.metadataWrite.affectedConfigurations', {
        names: summary.affectedConfigurations.join(', '),
      }),
    )
  }
  if (state !== 'writing' && needsWrite(state)) {
    parts.push(t('source.metadataWrite.runSyncMetadata'))
  }
  if (summary.hasPromotedUnconfirmed) parts.push(t('source.metadataWrite.promotedUnverified'))
  const title = parts.join(' — ')

  return (
    <span className="inline-flex items-center gap-0.5 flex-shrink-0" data-no-drag title={title}>
      {state === 'writing' ? (
        <Loader2 size={11} className={`animate-spin ${STATE_CLASS[state]}`} />
      ) : (
        <AlertTriangle size={11} className={STATE_CLASS[state]} />
      )}
    </span>
  )
}
