import { Loader2 } from 'lucide-react'

import { CHANNEL_IDS, channelMeta, isChannelId, type ChannelId } from '../lib/channels'

interface ChannelSelectProps {
  channel: ChannelId
  /** Null for a customer with no account: there is nothing to attach a channel to. */
  accountId: string | null
  /** Used in the confirmation toast. */
  label: string
  canEdit: boolean
  pending: boolean
  onChange: (accountId: string, channel: ChannelId, label: string) => void
  className?: string
}

/**
 * The one control that changes an account's sales channel.
 *
 * Renders as a badge that happens to be a <select>, so the value reads the same
 * whether or not you can edit it - the alternative, an edit affordance that
 * appears only for managers, makes the same account look like two different
 * things to two people.
 *
 * A customer with no account row falls back to the static badge: channel lives
 * on the account, so there would be nothing to write.
 */
export function ChannelSelect({
  channel,
  accountId,
  label,
  canEdit,
  pending,
  onChange,
  className = '',
}: ChannelSelectProps) {
  const meta = channelMeta(channel)

  if (!canEdit || !accountId) {
    return (
      <span
        className={`inline-block px-1.5 py-px rounded text-[10px] font-medium ${meta.badgeClass} ${className}`}
        title={
          accountId
            ? meta.description
            : `${meta.description}. Not editable: this customer is not grouped into an account.`
        }
      >
        {meta.label}
      </span>
    )
  }

  return (
    <span className={`relative inline-flex items-center ${className}`}>
      <select
        value={channel}
        disabled={pending}
        title={meta.description}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          const next = event.target.value
          if (isChannelId(next) && next !== channel) onChange(accountId, next, label)
        }}
        className={`appearance-none cursor-pointer rounded pl-1.5 pr-4 py-px text-[10px] font-medium border border-transparent hover:border-plm-border-light focus:outline-none focus:border-plm-accent disabled:opacity-50 ${meta.badgeClass}`}
      >
        {CHANNEL_IDS.map((id) => (
          <option key={id} value={id} className="bg-plm-bg text-plm-fg">
            {channelMeta(id).label}
          </option>
        ))}
      </select>

      {pending ? (
        <Loader2
          size={9}
          className="absolute right-1 animate-spin text-plm-fg-muted pointer-events-none"
        />
      ) : (
        <span className="absolute right-1.5 text-[7px] text-plm-fg-muted pointer-events-none">
          ▼
        </span>
      )}
    </span>
  )
}
