import { useState } from 'react'
import {
  AlertCircle,
  Building2,
  ExternalLink,
  Loader2,
  Mail,
  MapPin,
  Phone,
  User,
  X,
} from 'lucide-react'

import type { CustomerPanelState } from '@/stores/types'

import { EnrichmentReport } from './EnrichmentReport'
import { useCustomerDetail } from '../hooks/useCustomerDetail'
import {
  formatAmount,
  formatCount,
  formatDate,
  formatRelativeDays,
  MONEY_NOTE,
} from '../lib/format'
import { segmentMeta } from '../lib/segments'

interface CustomerDetailPanelProps {
  panel: CustomerPanelState
  onClose: () => void
}

type DetailTab = 'profile' | 'orders' | 'research'

const TABS: { id: DetailTab; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'orders', label: 'Orders' },
  { id: 'research', label: 'Research' },
]

/** Customer 360: profile, order history, top products and the AI research. */
export function CustomerDetailPanel({ panel, onClose }: CustomerDetailPanelProps) {
  const [tab, setTab] = useState<DetailTab>('profile')
  const detail = useCustomerDetail(panel.customerId)

  const customer = detail.customer

  const recencyDays = customer?.last_order_date
    ? Math.floor(
        (Date.now() - new Date(customer.last_order_date).getTime()) / (1000 * 60 * 60 * 24),
      )
    : null

  const segment = customer
    ? segmentMeta(
        deriveSegment(customer.order_count, customer.first_order_date, recencyDays),
      )
    : null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-start gap-2 px-3 py-2.5 border-b border-plm-border">
        <div className="w-7 h-7 rounded bg-plm-accent/15 flex items-center justify-center shrink-0 mt-0.5">
          {customer?.is_company ? (
            <Building2 size={14} className="text-plm-accent" />
          ) : (
            <User size={14} className="text-plm-accent" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-plm-fg truncate">
            {customer?.name ?? panel.name}
          </h3>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {segment && (
              <span
                className={`px-1.5 py-px rounded text-[10px] font-medium ${segment.badgeClass}`}
                title={segment.description}
              >
                {segment.label}
              </span>
            )}
            {customer?.is_active === false && (
              <span
                className="px-1.5 py-px rounded text-[10px] font-medium bg-plm-warning/15 text-plm-warning"
                title={
                  customer.odoo_missing_since
                    ? `Missing from Odoo since ${formatDate(customer.odoo_missing_since)}. The sync flags, never deletes.`
                    : 'No longer present in Odoo'
                }
              >
                Gone from Odoo
              </span>
            )}
            {detail.accountName && detail.accountName !== customer?.name && (
              <span className="text-[10px] text-plm-fg-muted truncate">{detail.accountName}</span>
            )}
          </div>
        </div>

        <button
          onClick={onClose}
          title="Close (Esc)"
          className="p-1 rounded text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-light transition-colors shrink-0"
        >
          <X size={14} />
        </button>
      </div>

      {customer && (
        <div className="grid grid-cols-3 border-b border-plm-border divide-x divide-plm-border">
          <Stat
            label="Lifetime spend"
            value={formatAmount(customer.total_spent)}
            hint={MONEY_NOTE}
          />
          <Stat label="Orders" value={formatCount(customer.order_count)} />
          <Stat label="Last order" value={formatRelativeDays(recencyDays)} />
        </div>
      )}

      <div className="flex border-b border-plm-border px-2">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            onClick={() => setTab(entry.id)}
            className={`px-2.5 py-1.5 text-[11px] font-medium border-b-2 -mb-px transition-colors ${
              tab === entry.id
                ? 'border-plm-accent text-plm-fg'
                : 'border-transparent text-plm-fg-muted hover:text-plm-fg'
            }`}
          >
            {entry.label}
            {entry.id === 'orders' && detail.orders.length > 0 && (
              <span className="ml-1 text-plm-fg-muted">{detail.orders.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {detail.loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={18} className="animate-spin text-plm-fg-muted" />
          </div>
        ) : detail.error ? (
          <div className="flex items-start gap-2 p-2 rounded bg-plm-error/10 border border-plm-error/30">
            <AlertCircle size={13} className="text-plm-error shrink-0 mt-0.5" />
            <span className="text-[11px] text-plm-fg-dim">{detail.error}</span>
          </div>
        ) : !customer ? (
          <p className="text-xs text-plm-fg-muted text-center py-8">Customer not found</p>
        ) : tab === 'profile' ? (
          <ProfileTab customer={customer} products={detail.products} />
        ) : tab === 'orders' ? (
          <OrdersTab orders={detail.orders} />
        ) : (
          <EnrichmentReport enrichment={detail.enrichment} />
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="px-2 py-1.5 text-center">
      <div className="text-[9px] uppercase tracking-wide text-plm-fg-muted">{label}</div>
      <div
        className="text-xs text-plm-fg tabular-nums mt-0.5 truncate"
        title={hint ? `${value} - ${hint}` : value}
      >
        {value}
      </div>
    </div>
  )
}

function ProfileTab({
  customer,
  products,
}: {
  customer: NonNullable<ReturnType<typeof useCustomerDetail>['customer']>
  products: ReturnType<typeof useCustomerDetail>['products']
}) {
  const address = [
    customer.street,
    customer.street2,
    [customer.zip, customer.city].filter(Boolean).join(' '),
    customer.state,
    customer.country,
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        {customer.email && (
          <ContactRow icon={Mail} value={customer.email} href={`mailto:${customer.email}`} />
        )}
        {customer.phone && (
          <ContactRow icon={Phone} value={customer.phone} href={`tel:${customer.phone}`} />
        )}
        {customer.website && (
          <ContactRow
            icon={ExternalLink}
            value={customer.website.replace(/^https?:\/\//, '')}
            href={
              customer.website.startsWith('http') ? customer.website : `https://${customer.website}`
            }
          />
        )}
        {address && (
          <div className="flex items-start gap-2 text-[11px]">
            <MapPin size={12} className="text-plm-fg-muted shrink-0 mt-0.5" />
            <span className="text-plm-fg-dim whitespace-pre-line">{address}</span>
          </div>
        )}
      </div>

      <Field label="Job title" value={customer.job_title} />
      <Field label="Industry (from Odoo)" value={customer.industry} />
      <Field label="VAT" value={customer.vat} />
      <Field label="Odoo partner" value={customer.erp_id ? `#${customer.erp_id}` : null} />
      <Field label="First order" value={formatDate(customer.first_order_date)} />
      <Field label="Units bought" value={formatCount(customer.item_count)} />

      {products.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wide text-plm-fg-muted mb-1.5">
            Top products
          </h4>
          <div className="space-y-1">
            {products.slice(0, 8).map((product) => (
              <div key={product.key} className="flex items-center gap-2 text-[11px]">
                <span className="flex-1 min-w-0 truncate text-plm-fg-dim" title={product.name}>
                  {product.name}
                </span>
                <span className="text-plm-fg-muted tabular-nums shrink-0">
                  ×{formatCount(product.quantity)}
                </span>
                <span className="text-plm-fg tabular-nums shrink-0 w-16 text-right">
                  {formatAmount(product.revenue)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-plm-fg-muted">
            Odoo product ids only - there is no link to PLM parts yet.
          </p>
        </div>
      )}
    </div>
  )
}

function OrdersTab({ orders }: { orders: ReturnType<typeof useCustomerDetail>['orders'] }) {
  if (orders.length === 0) {
    return <p className="text-xs text-plm-fg-muted text-center py-8">No orders on record</p>
  }

  return (
    <div className="space-y-1">
      {orders.map((order) => {
        const excluded = ['cancel', 'draft', 'sent'].includes(order.status?.toLowerCase() ?? '')

        return (
          <div
            key={order.id}
            className="flex items-center gap-2 px-2 py-1.5 rounded border border-plm-border bg-plm-bg-light"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-plm-fg truncate">
                {order.erp_id ? `SO #${order.erp_id}` : 'Order'}
              </div>
              <div className="text-[10px] text-plm-fg-muted">
                {formatDate(order.order_date)}
                {order.status && ` · ${order.status}`}
              </div>
            </div>

            <div className="text-right shrink-0">
              <div
                className={`text-[11px] tabular-nums ${excluded ? 'text-plm-fg-muted line-through' : 'text-plm-fg'}`}
                title={
                  excluded
                    ? 'Excluded from revenue: this order is not confirmed'
                    : 'Counted toward revenue'
                }
              >
                {formatAmount(order.total)}
              </div>
              {(order.items_count ?? 0) > 0 && (
                <div className="text-[10px] text-plm-fg-muted">
                  {formatCount(order.items_count)} items
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ContactRow({
  icon: Icon,
  value,
  href,
}: {
  icon: typeof Mail
  value: string
  href: string
}) {
  return (
    <a
      href={href}
      target={href.startsWith('http') ? '_blank' : undefined}
      rel="noreferrer noopener"
      className="flex items-center gap-2 text-[11px] text-plm-fg-dim hover:text-plm-accent transition-colors"
    >
      <Icon size={12} className="text-plm-fg-muted shrink-0" />
      <span className="truncate">{value}</span>
    </a>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value || value === '-') return null
  return (
    <div className="flex items-baseline gap-2 text-[11px]">
      <span className="text-plm-fg-muted w-32 shrink-0">{label}</span>
      <span className="text-plm-fg-dim flex-1 min-w-0 break-words">{value}</span>
    </div>
  )
}

/**
 * Mirrors customer_lifecycle_segment() in 60-customers.sql.
 *
 * Duplicated here because the panel loads a plain customers row rather than
 * going back through the RFM aggregate for a single record. The thresholds
 * must stay in step with the SQL; the branch order matters for the same reason.
 */
function deriveSegment(
  orderCount: number | null,
  firstOrder: string | null,
  recencyDays: number | null,
): string {
  if (!orderCount || recencyDays == null) return 'prospect'
  if (recencyDays > 365) return 'churned'
  if (recencyDays > 180) return 'at_risk'
  if (firstOrder) {
    const daysSinceFirst = (Date.now() - new Date(firstOrder).getTime()) / (1000 * 60 * 60 * 24)
    if (daysSinceFirst <= 90) return 'new'
  }
  return 'active'
}
