import { memo, useEffect, useState } from 'react'

import { useTranslation } from '@/lib/i18n'

/**
 * How long the vault may load before the overlay admits something may be wrong. A cold
 * load of a large vault runs a few seconds, so this is set well clear of the normal case.
 */
const STALL_THRESHOLD_MS = 20_000

export interface LoadingStateProps {
  message?: string
  /**
   * Full-screen blocking overlay. Pass false when the pane already has rows to show, so a
   * background load does not hide content the user can already work with.
   */
  overlay?: boolean
  onRetry?: () => void
}

/**
 * Loading state shown while files are being loaded.
 *
 * A load that never completes used to be indistinguishable from a slow one, because the
 * spinner had no upper bound. After STALL_THRESHOLD_MS it says so and offers a way out.
 */
export const LoadingState = memo(function LoadingState({
  message,
  overlay = true,
  onRetry,
}: LoadingStateProps) {
  const { t } = useTranslation()
  const [stalled, setStalled] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setStalled(true), STALL_THRESHOLD_MS)
    return () => clearTimeout(timer)
  }, [])

  const label = message ?? t('vaultLoad.loading')

  const spinner = (
    <div className="w-12 h-12 border-4 border-plm-accent/30 border-t-plm-accent rounded-full animate-spin" />
  )

  const retryButton = onRetry ? (
    <button
      type="button"
      onClick={onRetry}
      className="px-3 py-1.5 text-sm rounded border border-plm-border text-plm-fg hover:bg-plm-highlight"
    >
      {t('vaultLoad.retry')}
    </button>
  ) : null

  if (!overlay) {
    return (
      <div className="absolute bottom-0 inset-x-0 z-30 flex items-center justify-center gap-3 bg-plm-bg/90 border-t border-plm-border px-3 py-2">
        <div className="w-4 h-4 border-2 border-plm-accent/30 border-t-plm-accent rounded-full animate-spin" />
        <span className="text-xs text-plm-fg-muted">
          {stalled ? t('vaultLoad.stalled') : label}
        </span>
        {stalled ? retryButton : null}
      </div>
    )
  }

  return (
    <div className="absolute inset-0 z-30 bg-plm-bg/80 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        {spinner}
        <span className="text-sm text-plm-fg-muted">{label}</span>
        {stalled && (
          <div className="flex flex-col items-center gap-3">
            <span className="text-xs text-plm-fg-muted">{t('vaultLoad.stalled')}</span>
            {retryButton}
          </div>
        )}
      </div>
    </div>
  )
})
