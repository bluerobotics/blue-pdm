/**
 * Checked Out By column cell renderer
 */
import { Monitor } from 'lucide-react'
import { deriveCheckoutDisplay } from '@/lib/checkout/checkoutDisplay'
import { t } from '@/lib/i18n'
import { getInitials, getAvatarColor } from '@/lib/utils'
import { NotifiableCheckoutAvatar } from '@/components/shared/Avatar'
import { usePDMStore } from '@/stores/pdmStore'
import { useFilePaneContext } from '../../../context'
import type { CellRendererBaseProps } from './types'

export function CheckedOutByCell({ file }: CellRendererBaseProps): React.ReactNode {
  const { user, currentMachineId } = useFilePaneContext()
  const checkoutHydrationState = usePDMStore((state) =>
    file.pdmData?.id ? state.checkoutHydration[file.pdmData.id]?.state : undefined,
  )

  if (file.isDirectory || !file.pdmData?.checked_out_by) return ''

  const checkoutDisplay = deriveCheckoutDisplay(file, user, checkoutHydrationState)
  const avatarUrl = checkoutDisplay.avatarUrl
  const displayName = checkoutDisplay.displayName ?? t('checkoutDisplay.ownerUnavailable')
  const tooltipName = checkoutDisplay.email || displayName
  const isMe = checkoutDisplay.state === 'mine'
  const coMachineId = file.pdmData.checked_out_by_machine_id
  const coMachineName = file.pdmData.checked_out_by_machine_name
  const onDifferentMachine = Boolean(
    isMe && coMachineId && currentMachineId && coMachineId !== currentMachineId,
  )

  // For other users' checkouts, show the interactive avatar that can send notifications
  if (!isMe && checkoutDisplay.state === 'resolved' && file.pdmData.id && checkoutDisplay.profile) {
    return (
      <span className="flex items-center gap-2 text-plm-fg">
        <NotifiableCheckoutAvatar
          user={{
            id: file.pdmData.checked_out_by,
            email: checkoutDisplay.profile.email,
            full_name: checkoutDisplay.profile.full_name,
            avatar_url: checkoutDisplay.profile.avatar_url,
          }}
          fileId={file.pdmData.id}
          fileName={file.name}
          size={20}
        />
        <span className="truncate">{displayName}</span>
      </span>
    )
  }

  // For own checkouts, show the standard display
  // Get consistent avatar colors based on user identifier
  const avatarColors = getAvatarColor(checkoutDisplay.email || checkoutDisplay.displayName)

  return (
    <span
      className={`flex items-center gap-2 ${isMe ? (onDifferentMachine ? 'text-plm-warning' : 'text-plm-warning') : 'text-plm-fg'}`}
      title={
        onDifferentMachine
          ? t('checkoutDisplay.checkedOutByOnComputer', {
              name: t('checkoutDisplay.you'),
              computer: coMachineName || t('checkoutDisplay.anotherComputer'),
            })
          : tooltipName
      }
    >
      <div className="relative w-5 h-5 flex-shrink-0">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={displayName}
            title={tooltipName}
            className="w-5 h-5 rounded-full object-cover"
            referrerPolicy="no-referrer"
            onError={(e) => {
              const target = e.target as HTMLImageElement
              target.style.display = 'none'
              target.nextElementSibling?.classList.remove('hidden')
            }}
          />
        ) : null}
        <div
          className={`w-5 h-5 rounded-full ${onDifferentMachine ? 'bg-plm-warning/50 text-plm-warning' : `${avatarColors.bg} ${avatarColors.text}`} flex items-center justify-center text-xs font-medium absolute inset-0 ${avatarUrl ? 'hidden' : ''}`}
          title={tooltipName}
        >
          {getInitials(displayName, {
            placeholder: checkoutDisplay.state === 'hydrating' || checkoutDisplay.state === 'unavailable',
          })}
        </div>
        {/* Machine indicator for different machine */}
        {onDifferentMachine && (
          <div
            className="absolute -bottom-0.5 -right-0.5 bg-plm-warning rounded-full flex items-center justify-center"
            style={{ width: 10, height: 10 }}
            title={t('checkoutDisplay.checkedOutByOnComputer', {
              name: t('checkoutDisplay.you'),
              computer: coMachineName || t('checkoutDisplay.anotherComputer'),
            })}
          >
            <Monitor size={7} className="text-plm-bg" />
          </div>
        )}
      </div>
      <span className="truncate">{displayName}</span>
      {onDifferentMachine && (
        <span className="text-[10px] text-plm-warning opacity-75">
          ({coMachineName || t('checkoutDisplay.otherComputer')})
        </span>
      )}
    </span>
  )
}
