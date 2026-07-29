/**
 * Human-readable labels for sidebar modules
 * Used by Sidebar, ActivityBar, and other UI components
 */

import type { SidebarView } from '@/stores/types'
import { DEFAULT_CUSTOM_GROUPS } from '@/types/modules'

/** Display names for modules (sentence case) */
export const MODULE_LABELS: Record<SidebarView, string> = {
  // Source Files
  explorer: 'Explorer',
  pending: 'Pending Changes',
  history: 'History',
  workflows: 'File Workflows',
  reviews: 'Reviews',
  trash: 'Trash',
  // Items
  items: 'Item Browser',
  boms: 'BOMs',
  products: 'Products',
  // Change Control
  ecr: 'ECRs / Issues',
  eco: 'ECOs',
  deviations: 'Deviations',
  'release-schedule': 'Release Schedule',
  process: 'Process Editor',
  // Supply Chain - Suppliers
  'supplier-database': 'Supplier Database',
  'supplier-portal': 'Supplier Portal',
  // Supply Chain - Purchasing
  'purchase-requests': 'Purchase Requests',
  'purchase-orders': 'Purchase Orders',
  invoices: 'Invoices',
  // Supply Chain - Logistics
  shipping: 'Shipping',
  receiving: 'Receiving',
  // Customers
  customers: 'Customers',
  // Production
  'manufacturing-orders': 'Manufacturing Orders',
  travellers: 'Travellers',
  'work-instructions': 'Work Instructions',
  'production-schedule': 'Production Schedule',
  routings: 'Routings',
  'work-centers': 'Work Centers',
  'process-flows': 'Process Flows',
  equipment: 'Equipment',
  // Production - Analytics
  'yield-tracking': 'Yield Tracking',
  'error-codes': 'Error Codes',
  downtime: 'Downtime',
  oee: 'OEE Dashboard',
  'scrap-tracking': 'Scrap Tracking',
  // Quality
  fai: 'First Article Inspection (FAI)',
  ncr: 'Non-Conformance Report (NCR)',
  imr: 'Incoming Material Report (IMR)',
  scar: 'Supplier Corrective Action (SCAR)',
  capa: 'Corrective & Preventive Action (CAPA)',
  rma: 'Return Material Authorization (RMA)',
  certificates: 'Certificates',
  calibration: 'Calibration',
  'quality-templates': 'Templates',
  // Accounting
  'accounts-payable': 'Accounts Payable',
  'accounts-receivable': 'Accounts Receivable',
  'general-ledger': 'General Ledger',
  'cost-tracking': 'Cost Tracking',
  budgets: 'Budgets',
  // Integrations
  'google-drive': 'Google Drive',
  // System
  terminal: 'Terminal',
  settings: 'Settings',
}

/** Header titles for sidebar (uppercase) */
export const MODULE_TITLES: Record<SidebarView, string> = Object.fromEntries(
  Object.entries(MODULE_LABELS).map(([key, value]) => [key, value.toUpperCase()]),
) as Record<SidebarView, string>

/** Get module label with fallback */
export function getModuleLabel(view: SidebarView): string {
  if (MODULE_LABELS[view]) return MODULE_LABELS[view]
  const viewStr = view as string
  if (viewStr.startsWith('group-')) {
    const group = DEFAULT_CUSTOM_GROUPS.find((g) => g.id === viewStr)
    if (group) return group.name
  }
  return 'Explorer'
}

/** Get module title (uppercase) with fallback */
export function getModuleTitle(view: SidebarView): string {
  if (MODULE_TITLES[view]) return MODULE_TITLES[view]
  const viewStr = view as string
  if (viewStr.startsWith('group-')) {
    const group = DEFAULT_CUSTOM_GROUPS.find((g) => g.id === viewStr)
    if (group) return group.name.toUpperCase()
  }
  return 'EXPLORER'
}
