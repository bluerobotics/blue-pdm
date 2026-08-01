/**
 * One workflow gate waiting on the signed-in user's decision. Approving the
 * last blocking gate is what actually moves the file, so the row shows which
 * state change it is holding up.
 */
import { ArrowRight, CheckCircle2, Loader2, ShieldCheck, Undo2, XCircle } from 'lucide-react'

import { t } from '@/lib/i18n'
import type { MyPendingReview } from '@/types/workflow'

import type { GateDecision } from '../hooks/useGateReviews'

interface GateReviewRowProps {
  review: MyPendingReview
  isDeciding: boolean
  onDecide: (reviewId: string, decision: GateDecision) => void
}

export function GateReviewRow({ review, isDeciding, onDecide }: GateReviewRowProps) {
  return (
    <div className="rounded-md border border-plm-border bg-plm-bg-light p-2">
      <div className="flex items-center gap-1.5">
        <ShieldCheck size={12} className="text-plm-warning flex-shrink-0" />
        <span className="text-xs font-medium text-plm-fg truncate">{review.file_name}</span>
      </div>

      <div className="mt-1 flex items-center gap-1 text-[10px] text-plm-fg-muted">
        <span>{review.from_state_name}</span>
        <ArrowRight size={10} />
        <span>{review.to_state_name}</span>
        <span className="mx-1">·</span>
        <span className="truncate">{review.gate_name}</span>
      </div>

      <p className="mt-1 text-[10px] text-plm-fg-muted truncate">
        {t('reviews.gates.requestedBy', { email: review.requested_by_email })}
      </p>

      <div className="mt-2 flex items-center gap-1">
        <button
          onClick={() => onDecide(review.review_id, 'approved')}
          disabled={isDeciding}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-plm-success/15 text-plm-success hover:bg-plm-success/25 disabled:opacity-50"
        >
          {isDeciding ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <CheckCircle2 size={10} />
          )}
          {t('reviews.gates.approve')}
        </button>
        <button
          onClick={() => onDecide(review.review_id, 'kicked_back')}
          disabled={isDeciding}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-plm-warning/15 text-plm-warning hover:bg-plm-warning/25 disabled:opacity-50"
        >
          <Undo2 size={10} />
          {t('reviews.gates.kickBack')}
        </button>
        <button
          onClick={() => onDecide(review.review_id, 'rejected')}
          disabled={isDeciding}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-plm-error/15 text-plm-error hover:bg-plm-error/25 disabled:opacity-50"
        >
          <XCircle size={10} />
          {t('reviews.gates.reject')}
        </button>
      </div>
    </div>
  )
}
