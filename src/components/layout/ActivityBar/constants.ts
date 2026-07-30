import type { ModuleId } from '@/types/modules'

// Translation keys for module names
export const moduleTranslationKeys: Record<ModuleId, string> = {
  // Source Files
  explorer: 'sidebar.explorer',
  pending: 'sidebar.pending',
  history: 'sidebar.history',
  workflows: 'sidebar.workflows',
  reviews: 'sidebar.reviews',
  trash: 'sidebar.trash',
  // Products
  products: 'sidebar.products',
  items: 'sidebar.items',
  // Change Control
  ecr: 'sidebar.ecr',
  eco: 'sidebar.eco',
  deviations: 'sidebar.deviations',
  'release-schedule': 'sidebar.releaseSchedule',
  process: 'sidebar.process',
  // Supply Chain - Suppliers
  'supplier-database': 'sidebar.supplierDatabase',
  'supplier-portal': 'sidebar.supplierPortal',
  // Customers
  customers: 'sidebar.customers',
  // Integrations
  'google-drive': 'sidebar.googleDrive',
  // System
  terminal: 'sidebar.terminal',
  settings: 'sidebar.settings',
}
