import { useCallback, useState } from 'react'

import { usePDMStore } from '@/stores/pdmStore'

import { setAccountChannel } from '../data/api'
import { channelMeta, type ChannelId } from '../lib/channels'

export interface SetAccountChannelResult {
  /** False when the user lacks module:customers edit; the controls render read-only. */
  canEdit: boolean
  /** The account currently being written, for a per-row spinner. */
  pendingId: string | null
  setChannel: (accountId: string, channel: ChannelId, label: string) => Promise<void>
}

/**
 * Moves an account between sales channels.
 *
 * A successful write invalidates the whole customer cache rather than patching
 * the roster in place. Channel appears in the RFM rows, the account roll-up and
 * the per-channel counts, so a local patch would have to be applied in three
 * places and would be the only path by which those three could disagree. The
 * cost is a refetch per change, which is the right trade for something done to
 * a few dozen accounts and then left alone.
 */
export function useSetAccountChannel(): SetAccountChannelResult {
  const hasPermission = usePDMStore((s) => s.hasPermission)
  const addToast = usePDMStore((s) => s.addToast)
  const invalidateCustomerData = usePDMStore((s) => s.invalidateCustomerData)

  const [pendingId, setPendingId] = useState<string | null>(null)

  const canEdit = hasPermission('module:customers', 'edit')

  const setChannel = useCallback(
    async (accountId: string, channel: ChannelId, label: string) => {
      setPendingId(accountId)

      try {
        await setAccountChannel(accountId, channel)
        invalidateCustomerData()
        addToast('success', `${label} is now a ${channelMeta(channel).label.toLowerCase()} account`)
      } catch (cause: unknown) {
        addToast(
          'error',
          `Could not change the channel: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
      } finally {
        setPendingId(null)
      }
    },
    [addToast, invalidateCustomerData],
  )

  return { canEdit, pendingId, setChannel }
}
