import type { CustomerRfmRow } from '../data/types'
import { segmentMeta } from './segments'

const COLUMNS: { header: string; value: (row: CustomerRfmRow) => string | number | null }[] = [
  { header: 'Customer', value: (row) => row.name },
  { header: 'Account', value: (row) => row.account_name },
  { header: 'Email', value: (row) => row.email },
  { header: 'City', value: (row) => row.city },
  { header: 'Country', value: (row) => row.country },
  { header: 'Segment', value: (row) => segmentMeta(row.segment).label },
  { header: 'Category', value: (row) => row.category_label },
  { header: 'Orders', value: (row) => row.order_count },
  { header: 'Total spent', value: (row) => row.total_spent },
  { header: 'First order', value: (row) => row.first_order_date },
  { header: 'Last order', value: (row) => row.last_order_date },
  { header: 'Days since last order', value: (row) => row.recency_days },
  { header: 'R', value: (row) => row.r_score },
  { header: 'F', value: (row) => row.f_score },
  { header: 'M', value: (row) => row.m_score },
  { header: 'In Odoo', value: (row) => (row.is_active === false ? 'no' : 'yes') },
]

function escapeCell(value: string | number | null): string {
  if (value == null) return ''
  const text = String(value)
  // A leading =, +, - or @ makes Excel treat the cell as a formula. Customer
  // names come from an external system, so they are prefixed to stay inert.
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

/** Downloads the currently filtered customers as CSV. */
export function exportCustomersCsv(rows: CustomerRfmRow[]): void {
  if (rows.length === 0) return

  const lines = [
    COLUMNS.map((column) => escapeCell(column.header)).join(','),
    ...rows.map((row) => COLUMNS.map((column) => escapeCell(column.value(row))).join(',')),
  ]

  // The BOM makes Excel read the file as UTF-8; without it, accented customer
  // names from a European Odoo render as mojibake.
  const blob = new Blob([`\ufeff${lines.join('\r\n')}`], {
    type: 'text/csv;charset=utf-8;',
  })

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
