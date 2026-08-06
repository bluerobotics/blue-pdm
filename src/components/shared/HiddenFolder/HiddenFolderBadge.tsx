import { EyeOff } from 'lucide-react'

import { useTranslation } from '@/lib/i18n'

interface HiddenFolderBadgeProps {
  size?: number
  className?: string
}

/** Marks a folder that admins can see but non-admins cannot. */
export function HiddenFolderBadge({ size = 11, className = '' }: HiddenFolderBadgeProps) {
  const { t } = useTranslation()

  return (
    <EyeOff
      size={size}
      className={`shrink-0 text-plm-fg-dim ${className}`}
      aria-label={t('hiddenFolders.badgeLabel')}
    />
  )
}
