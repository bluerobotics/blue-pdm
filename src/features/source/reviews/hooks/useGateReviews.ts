/**
 * Gate reviews waiting on the signed-in user.
 *
 * These are the reviews a gated workflow transition opens. Deciding one goes
 * through `complete_gate_review`, which is also what advances the file once the
 * last blocking gate clears - the client never moves the file itself.
 */
import { useCallback, useEffect, useState } from 'react'

import { log } from '@/lib/logger'
import { t } from '@/lib/i18n'
import { usePDMStore } from '@/stores/pdmStore'
import { getMyPendingReviews, submitReviewDecision } from '@/lib/workflows'
import type { MyPendingReview } from '@/types/workflow'

export type GateDecision = 'approved' | 'rejected' | 'kicked_back'

export function useGateReviews() {
  const user = usePDMStore((s) => s.user)
  const addToast = usePDMStore((s) => s.addToast)

  const [reviews, setReviews] = useState<MyPendingReview[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [decidingId, setDecidingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user) {
      setReviews([])
      return
    }

    setIsLoading(true)
    const { data, error } = await getMyPendingReviews()
    if (error) {
      log.error('[Workflow]', 'Failed to load gate reviews', { error })
      setReviews([])
    } else {
      setReviews(data ?? [])
    }
    setIsLoading(false)
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const decide = useCallback(
    async (reviewId: string, decision: GateDecision, comment?: string) => {
      setDecidingId(reviewId)
      try {
        const { data, error } = await submitReviewDecision(reviewId, decision, comment)

        if (error || !data?.success) {
          addToast('error', error?.message ?? data?.error_message ?? t('reviews.gates.failed'))
          return
        }

        if (data.new_state_name) {
          addToast(
            'success',
            t('reviews.gates.advanced', { state: data.new_state_name }),
          )
        } else if (decision === 'approved') {
          addToast('success', t('reviews.gates.approved'))
        } else {
          addToast('success', t('reviews.gates.rejected'))
        }

        // The decision may have cancelled sibling reviews or advanced the file,
        // so reload rather than patching this one row out of the list.
        await refresh()
      } finally {
        setDecidingId(null)
      }
    },
    [addToast, refresh],
  )

  return { reviews, isLoading, decidingId, refresh, decide }
}
