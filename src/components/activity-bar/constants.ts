import type { ModuleId } from '../../types/modules'

// Translation keys for module names
export const moduleTranslationKeys: Record<ModuleId, string> = {
  // Source Files
  'explorer': 'sidebar.explorer',
  'pending': 'sidebar.pending',
  'history': 'sidebar.history',
  'workflows': 'sidebar.workflows',
  'trash': 'sidebar.trash',
  // Items
  'items': 'sidebar.items',
  'boms': 'sidebar.boms',
  'products': 'sidebar.products',
  // Change Control
  'ecr': 'sidebar.ecr',
  'eco': 'sidebar.eco',
  'notifications': 'sidebar.notifications',
  'deviations': 'sidebar.deviations',
  'release-schedule': 'sidebar.releaseSchedule',
  'process': 'sidebar.process',
  // Supply Chain - Suppliers
  'supplier-database': 'sidebar.supplierDatabase',
  'supplier-portal': 'sidebar.supplierPortal',
  // Supply Chain - Purchasing
  'purchase-requests': 'sidebar.purchaseRequests',
  'purchase-orders': 'sidebar.purchaseOrders',
  'invoices': 'sidebar.invoices',
  // Supply Chain - Logistics
  'shipping': 'sidebar.shipping',
  'receiving': 'sidebar.receiving',
  // Production
  'manufacturing-orders': 'sidebar.manufacturingOrders',
  'travellers': 'sidebar.travellers',
  'work-instructions': 'sidebar.workInstructions',
  'production-schedule': 'sidebar.productionSchedule',
  'routings': 'sidebar.routings',
  'work-centers': 'sidebar.workCenters',
  'process-flows': 'sidebar.processFlows',
  'equipment': 'sidebar.equipment',
  // Production - Analytics submenu
  'production-analytics': 'sidebar.productionAnalytics',
  'yield-tracking': 'sidebar.yieldTracking',
  'error-codes': 'sidebar.errorCodes',
  'downtime': 'sidebar.downtime',
  'oee': 'sidebar.oee',
  'scrap-tracking': 'sidebar.scrapTracking',
  // Quality
  'fai': 'sidebar.fai',
  'ncr': 'sidebar.ncr',
  'imr': 'sidebar.imr',
  'scar': 'sidebar.scar',
  'capa': 'sidebar.capa',
  'rma': 'sidebar.rma',
  'certificates': 'sidebar.certificates',
  'calibration': 'sidebar.calibration',
  'quality-templates': 'sidebar.qualityTemplates',
  // Accounting
  'accounts-payable': 'sidebar.accountsPayable',
  'accounts-receivable': 'sidebar.accountsReceivable',
  'general-ledger': 'sidebar.generalLedger',
  'cost-tracking': 'sidebar.costTracking',
  'budgets': 'sidebar.budgets',
  // Integrations
  'google-drive': 'sidebar.googleDrive',
  // System
  'terminal': 'sidebar.terminal',
  'settings': 'sidebar.settings',
}
