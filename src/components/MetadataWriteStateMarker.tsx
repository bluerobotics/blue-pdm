/**
 * The mark on a value the user typed that is not in the SolidWorks file.
 *
 * The previous release had no way to show this, and that absence was the whole argument for throwing
 * a failed edit away: a value that stayed put looked identical to one the file had accepted, and
 * check-in would promote it as though it had. Given somewhere to put the mark, keeping the value is
 * plainly the better answer - the user's typing survives, and it is labelled.
 *
 * What it shows, in order of how much it should worry someone:
 *
 * - **failed** and **unattempted**: the value is definitely not in the file. Red, with a retry.
 * - **unverified**: the write was made and could not be confirmed. Amber, with a retry, because a
 *   retry is the only way to find out and re-writing a correct value costs nothing.
 * - **pending**: edited, nothing attempted yet. Muted, with a retry.
 * - **verified**: nothing at all. A confirmed value needs no decoration.
 *
 * One mark can only show one state, so the most alarming among the addresses it covers wins - see
 * `summarizeWriteState`. The configuration names come with it, because "not written" on a part with
 * 68 configurations is only actionable if it says which ones.
 *
 * A `field` narrows the mark to the column it sits in, so a failed configuration tab is flagged on
 * Tab Number rather than on all four datacard columns at once. Omitting it marks the file as a whole,
 * which is what a panel wants.
 */

import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'

import { t } from '@/lib/i18n'
import { retryEdit } from '@/lib/metadata/pendingEdits'
import {
  resolveFileWriteState,
  scopePendingToGroup,
  scopeRecordToGroup,
  summarizeWriteState,
  type MetadataFieldGroup,
  type MetadataWriteDisplayState,
} from '@/lib/metadata/writeState'
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
  /** Runs the write again for everything still pending on this file. */
  onRetry?: (file: LocalFile, edit: ReturnType<typeof retryEdit>) => void
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
  onRetry,
  isWriting,
}: MetadataWriteStateMarkerProps): React.ReactNode {
  const pending = field ? scopePendingToGroup(file.pendingMetadata, field) : file.pendingMetadata
  const record = field ? scopeRecordToGroup(file.metadataWriteState, field) : file.metadataWriteState

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
  if (summary.hasPromotedUnconfirmed) parts.push(t('source.metadataWrite.promotedUnverified'))
  const title = parts.join(' — ')

  return (
    <span className="inline-flex items-center gap-0.5 flex-shrink-0" data-no-drag title={title}>
      {state === 'writing' ? (
        <Loader2 size={11} className={`animate-spin ${STATE_CLASS[state]}`} />
      ) : (
        <AlertTriangle size={11} className={STATE_CLASS[state]} />
      )}
      {onRetry && state !== 'writing' && (
        <button
          onClick={(event) => {
            event.stopPropagation()
            event.preventDefault()
            onRetry(file, retryEdit(file.path, file.pendingMetadata))
          }}
          onMouseDown={(event) => event.stopPropagation()}
          className="p-0.5 rounded text-plm-fg-muted hover:text-plm-accent hover:bg-plm-accent/20 transition-colors"
          title={t('source.metadataWrite.retry')}
        >
          <RefreshCw size={10} />
        </button>
      )}
    </span>
  )
}
