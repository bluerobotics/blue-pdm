import { Monitor } from 'lucide-react'
import { t } from '@/lib/i18n'
import { getInitials, getAvatarColor } from '@/lib/utils'
import { NotifiableCheckoutAvatar } from '@/components/shared/Avatar'
import type { CheckoutDisplayState } from '@/types/pdm'

export interface CheckoutBadgeUser {
  id: string
  name: string
  email?: string
  avatar_url?: string
  isMe: boolean
  displayState?: CheckoutDisplayState
  isDifferentMachine?: boolean
  machineName?: string
  /** For folders: list of file IDs this user has checked out */
  fileIds?: string[]
}

export interface CheckoutBadgeProps {
  checkoutUsers: CheckoutBadgeUser[]
  avatarSize: number
  avatarFontSize: number
  /** File ID (required for notification functionality on single files) */
  fileId?: string
  /** File/folder name for notification */
  fileName?: string
  /** Whether this is a folder */
  isFolder?: boolean
}

/**
 * Badge showing checkout user avatars with notification capability
 * Works for both files and folders - on folders, users can be notified about all their checkouts
 *
 * Note: For card view, we filter out "isMe" users on the same machine since the
 * check-in action button already indicates the user has the file checked out.
 * We still show "isMe" users on different machines as a warning.
 */
export function CheckoutBadge({
  checkoutUsers,
  avatarSize,
  avatarFontSize,
  fileId,
  fileName,
  isFolder = false,
}: CheckoutBadgeProps) {
  // Filter out the current user on the same machine (redundant with action buttons)
  // Keep showing if on a different machine (important warning)
  const displayUsers = checkoutUsers.filter((u) => !u.isMe || u.isDifferentMachine)

  if (displayUsers.length === 0) return null

  return (
    <div
      className="flex"
      style={{ marginLeft: -avatarSize * 0.25 }}
      title={displayUsers.map((u) => u.name).join(', ')}
    >
      {displayUsers.slice(0, 3).map((u, i) => (
        <div
          key={u.id}
          className="relative"
          style={{
            zIndex: 3 - i,
            marginLeft: i > 0 ? -avatarSize * 0.3 : 0,
          }}
          title={
            u.isDifferentMachine && u.machineName
              ? t('checkoutDisplay.checkedOutByOnComputer', {
                  name: u.name,
                  computer: u.machineName,
                })
              : undefined
          }
        >
          {/* For other users' checkouts, use NotifiableCheckoutAvatar (works for both files and folders) */}
          {!u.isMe &&
          u.displayState !== 'hydrating' &&
          u.displayState !== 'unavailable' &&
          fileName &&
          (fileId || (isFolder && u.fileIds && u.fileIds.length > 0)) ? (
            <NotifiableCheckoutAvatar
              user={{
                id: u.id,
                email: u.email,
                full_name: u.name,
                avatar_url: u.avatar_url,
              }}
              fileId={isFolder ? undefined : fileId}
              fileName={fileName}
              size={avatarSize}
              fontSize={avatarFontSize}
              folderFileIds={isFolder ? u.fileIds : undefined}
            />
          ) : (
            (() => {
              const avatarColors = getAvatarColor(u.email || u.name)
              return (
                <>
                  {u.avatar_url ? (
                    <img
                      src={u.avatar_url}
                      alt={u.name}
                      className="rounded-full bg-plm-bg object-cover"
                      style={{ width: avatarSize, height: avatarSize }}
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement
                        target.style.display = 'none'
                        target.nextElementSibling?.classList.remove('hidden')
                      }}
                    />
                  ) : null}
                  <div
                    className={`rounded-full ${u.isMe ? (u.isDifferentMachine ? 'bg-plm-warning/50 text-plm-warning' : `${avatarColors.bg} ${avatarColors.text}`) : `${avatarColors.bg} ${avatarColors.text}`} flex items-center justify-center font-medium ${u.avatar_url ? 'hidden' : ''}`}
                    style={{ width: avatarSize, height: avatarSize, fontSize: avatarFontSize }}
                  >
                    {getInitials(u.name, {
                      placeholder:
                        u.displayState === 'hydrating' || u.displayState === 'unavailable',
                    })}
                  </div>
                  {u.isDifferentMachine && (
                    <div
                      className="absolute -bottom-0.5 -right-0.5 bg-plm-warning rounded-full p-0.5"
                      style={{ width: avatarSize * 0.4, height: avatarSize * 0.4 }}
                      title={t('checkoutDisplay.checkedOutByOnComputer', {
                        name: u.name,
                        computer: u.machineName || t('checkoutDisplay.anotherComputer'),
                      })}
                    >
                      <Monitor size={avatarSize * 0.3} className="text-plm-bg w-full h-full" />
                    </div>
                  )}
                </>
              )
            })()
          )}
        </div>
      ))}
      {displayUsers.length > 3 && (
        <div
          className="rounded-full bg-plm-bg-light flex items-center justify-center text-plm-fg-muted font-medium"
          style={{
            width: avatarSize,
            height: avatarSize,
            fontSize: avatarFontSize,
            marginLeft: -avatarSize * 0.3,
            zIndex: 0,
          }}
        >
          +{displayUsers.length - 3}
        </div>
      )}
    </div>
  )
}
