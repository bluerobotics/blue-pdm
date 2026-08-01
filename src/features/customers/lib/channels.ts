/**
 * Sales channel: how an account buys from us.
 *
 * Mirrors the CHECK constraint on customer_accounts.channel. Three separate
 * questions get asked about a customer and it is worth keeping them apart:
 *
 *   channel   how they buy from us       here, set by a person
 *   kind      company or private person  derived by the Odoo sync
 *   category  what industry they are in  guessed by AI enrichment
 *
 * Unlike the lifecycle segment, none of this is computed - a channel is only
 * ever what someone said it is, seeded from the list of partners we can name
 * and changed only by hand thereafter.
 */

export const CHANNEL_IDS = ['direct', 'distributor', 'integrator'] as const

export type ChannelId = (typeof CHANNEL_IDS)[number]

/** The channels a person actually curates. 'direct' is just everyone else. */
export const PARTNER_CHANNEL_IDS = ['distributor', 'integrator'] as const

export type PartnerChannelId = (typeof PARTNER_CHANNEL_IDS)[number]

export interface ChannelMeta {
  id: ChannelId
  label: string
  /** Tab and heading form. */
  plural: string
  /** Shown as the tooltip wherever the badge appears, so it states the rule. */
  description: string
  badgeClass: string
}

export const CHANNELS: Record<ChannelId, ChannelMeta> = {
  direct: {
    id: 'direct',
    label: 'Direct',
    plural: 'Direct',
    description: 'Buys from us for their own use - a company or a private person',
    badgeClass: 'bg-plm-fg-muted/15 text-plm-fg-muted',
  },
  distributor: {
    id: 'distributor',
    label: 'Distributor',
    plural: 'Distributors',
    description: 'Authorized distributor: stocks and resells the product in their region',
    badgeClass: 'bg-plm-accent/15 text-plm-accent',
  },
  integrator: {
    id: 'integrator',
    label: 'Integrator',
    plural: 'Integrators',
    description: 'Builds our products into a larger system they sell on',
    badgeClass: 'bg-plm-info/15 text-plm-info',
  },
}

export function channelMeta(id: string | null | undefined): ChannelMeta {
  if (id && id in CHANNELS) return CHANNELS[id as ChannelId]
  return CHANNELS.direct
}

export function isChannelId(value: string): value is ChannelId {
  return (CHANNEL_IDS as readonly string[]).includes(value)
}
