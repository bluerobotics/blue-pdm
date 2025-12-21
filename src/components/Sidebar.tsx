import { lazy, Suspense } from 'react'
import { usePDMStore } from '../stores/pdmStore'
import type { SettingsTab } from '../types/settings'
import { isModuleVisible } from '../types/modules'
import { Loader2, Construction } from 'lucide-react'

// Eagerly loaded views (always needed)
import { SettingsNavigation } from './sidebar/SettingsNavigation'

// Lazy loaded views - only loaded when the module is enabled and selected
const ExplorerView = lazy(() => import('./sidebar/ExplorerView').then(m => ({ default: m.ExplorerView })))
const PendingView = lazy(() => import('./sidebar/PendingView').then(m => ({ default: m.PendingView })))
const WorkflowsView = lazy(() => import('./sidebar/WorkflowsView').then(m => ({ default: m.WorkflowsView })))
const HistoryView = lazy(() => import('./sidebar/HistoryView').then(m => ({ default: m.HistoryView })))
const TrashView = lazy(() => import('./sidebar/TrashView').then(m => ({ default: m.TrashView })))
const TerminalView = lazy(() => import('./sidebar/TerminalView').then(m => ({ default: m.TerminalView })))
const ECOView = lazy(() => import('./sidebar/ECOView').then(m => ({ default: m.ECOView })))
const ECRView = lazy(() => import('./sidebar/ECRView').then(m => ({ default: m.ECRView })))
const DeviationsView = lazy(() => import('./sidebar/DeviationsView').then(m => ({ default: m.DeviationsView })))
const ProductsView = lazy(() => import('./sidebar/ProductsView').then(m => ({ default: m.ProductsView })))
const ProcessView = lazy(() => import('./sidebar/ProcessView').then(m => ({ default: m.ProcessView })))
const ScheduleView = lazy(() => import('./sidebar/ScheduleView').then(m => ({ default: m.ScheduleView })))
const NotificationsView = lazy(() => import('./sidebar/NotificationsView').then(m => ({ default: m.NotificationsView })))
const SuppliersView = lazy(() => import('./sidebar/SuppliersView').then(m => ({ default: m.SuppliersView })))
const SupplierPortalView = lazy(() => import('./sidebar/SupplierPortalView').then(m => ({ default: m.SupplierPortalView })))
const GoogleDriveView = lazy(() => import('./sidebar/GoogleDriveView').then(m => ({ default: m.GoogleDriveView })))

interface SidebarProps {
  onOpenVault: () => void
  onOpenRecentVault: (path: string) => void
  onRefresh: (silent?: boolean) => void
  settingsTab?: SettingsTab
  onSettingsTabChange?: (tab: SettingsTab) => void
}

// Fixed width for settings view (not resizable)
const SETTINGS_SIDEBAR_WIDTH = 200

// Loading fallback for lazy-loaded views
function ViewLoading() {
  return (
    <div className="flex items-center justify-center h-32 text-plm-fg-muted">
      <Loader2 size={20} className="animate-spin" />
    </div>
  )
}

// Fallback for disabled modules
function ModuleDisabled({ moduleName }: { moduleName: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-32 text-plm-fg-muted p-4 text-center">
      <p className="text-sm">
        The <span className="font-medium">{moduleName}</span> module is disabled.
      </p>
      <p className="text-xs mt-1 text-plm-fg-dim">
        Enable it in Settings → Modules
      </p>
    </div>
  )
}

// Placeholder for modules not yet implemented
function ModuleComingSoon({ moduleName }: { moduleName: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 text-plm-fg-muted p-4 text-center">
      <Construction size={32} className="mb-3 text-plm-accent" />
      <p className="text-sm font-medium">
        {moduleName}
      </p>
      <p className="text-xs mt-1 text-plm-fg-dim">
        Coming soon
      </p>
    </div>
  )
}

export function Sidebar({ onOpenVault, onOpenRecentVault, onRefresh, settingsTab = 'profile', onSettingsTabChange }: SidebarProps) {
  const { activeView, sidebarWidth, connectedVaults, moduleConfig } = usePDMStore()
  
  // Settings view uses fixed width, others use resizable width
  const effectiveWidth = activeView === 'settings' ? SETTINGS_SIDEBAR_WIDTH : sidebarWidth

  const renderView = () => {
    // Settings is always available
    if (activeView === 'settings') {
      return <SettingsNavigation activeTab={settingsTab} onTabChange={onSettingsTabChange || (() => {})} />
    }
    
    // Check if the module is enabled for all other views
    const moduleId = activeView as string
    const isEnabled = isModuleVisible(moduleId as any, moduleConfig)
    
    // Map view names to readable names for the disabled message
    const viewNames: Record<string, string> = {
      // Source Files
      'explorer': 'Explorer',
      'pending': 'Pending Changes',
      'history': 'History',
      'workflows': 'File Workflows',
      'trash': 'Trash',
      // Items
      'items': 'Item Browser',
      'boms': 'BOMs',
      'products': 'Products',
      // Change Control
      'ecr': 'ECRs / Issues',
      'eco': 'ECOs',
      'notifications': 'Notifications',
      'deviations': 'Deviations',
      'release-schedule': 'Release Schedule',
      'process': 'Process Editor',
      // Supply Chain - Suppliers
      'supplier-database': 'Supplier Database',
      'supplier-portal': 'Supplier Portal',
      // Supply Chain - Purchasing
      'purchase-requests': 'Purchase Requests',
      'purchase-orders': 'Purchase Orders',
      'invoices': 'Invoices',
      // Supply Chain - Logistics
      'shipping': 'Shipping',
      'receiving': 'Receiving',
      // Production
      'manufacturing-orders': 'Manufacturing Orders',
      'travellers': 'Travellers',
      'work-instructions': 'Work Instructions',
      'production-schedule': 'Production Schedule',
      'routings': 'Routings',
      'work-centers': 'Work Centers',
      'process-flows': 'Process Flows',
      'equipment': 'Equipment',
      // Production - Analytics
      'yield-tracking': 'Yield Tracking',
      'error-codes': 'Error Codes',
      'downtime': 'Downtime',
      'oee': 'OEE Dashboard',
      'scrap-tracking': 'Scrap Tracking',
      // Quality
      'fai': 'First Article Inspection (FAI)',
      'ncr': 'Non-Conformance Report (NCR)',
      'imr': 'Incoming Material Report (IMR)',
      'scar': 'Supplier Corrective Action (SCAR)',
      'capa': 'Corrective & Preventive Action (CAPA)',
      'rma': 'Return Material Authorization (RMA)',
      'certificates': 'Certificates',
      'calibration': 'Calibration',
      'quality-templates': 'Templates',
      // Integrations
      'google-drive': 'Google Drive',
      // System
      'terminal': 'Terminal',
    }
    
    switch (activeView) {
      // ============================================
      // SOURCE FILES
      // ============================================
      case 'explorer':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <ExplorerView onOpenVault={onOpenVault} onOpenRecentVault={onOpenRecentVault} onRefresh={onRefresh} />
          </Suspense>
        ) : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'pending':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <PendingView onRefresh={onRefresh} />
          </Suspense>
        ) : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'history':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <HistoryView />
          </Suspense>
        ) : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'workflows':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <WorkflowsView />
          </Suspense>
        ) : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'trash':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <TrashView />
          </Suspense>
        ) : <ModuleDisabled moduleName={viewNames[activeView]} />

      // ============================================
      // ITEMS
      // ============================================
      case 'items':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'boms':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'products':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <ProductsView />
          </Suspense>
        ) : <ModuleDisabled moduleName={viewNames[activeView]} />

      // ============================================
      // CHANGE CONTROL
      // ============================================
      case 'ecr':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <ECRView />
          </Suspense>
        ) : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'eco':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <ECOView />
          </Suspense>
        ) : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'notifications':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <NotificationsView />
          </Suspense>
        ) : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'deviations':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <DeviationsView />
          </Suspense>
        ) : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'release-schedule':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <ScheduleView />
          </Suspense>
        ) : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'process':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <ProcessView />
          </Suspense>
        ) : <ModuleDisabled moduleName={viewNames[activeView]} />

      // ============================================
      // SUPPLY CHAIN - SUPPLIERS
      // ============================================
      case 'supplier-database':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <SuppliersView />
          </Suspense>
        ) : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'supplier-portal':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <SupplierPortalView />
          </Suspense>
        ) : <ModuleDisabled moduleName={viewNames[activeView]} />

      // ============================================
      // SUPPLY CHAIN - PURCHASING
      // ============================================
      case 'purchase-requests':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'purchase-orders':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'invoices':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />

      // ============================================
      // SUPPLY CHAIN - LOGISTICS
      // ============================================
      case 'shipping':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'receiving':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />

      // ============================================
      // PRODUCTION
      // ============================================
      case 'manufacturing-orders':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'travellers':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'work-instructions':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'production-schedule':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'routings':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'work-centers':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'process-flows':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'equipment':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />

      // ============================================
      // PRODUCTION - ANALYTICS
      // ============================================
      case 'yield-tracking':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'error-codes':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'downtime':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'oee':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'scrap-tracking':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />

      // ============================================
      // QUALITY
      // ============================================
      case 'fai':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'ncr':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'imr':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'scar':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'capa':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'rma':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'certificates':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'calibration':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      case 'quality-templates':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />

      // ============================================
      // ACCOUNTING
      // ============================================
      case 'accounts-payable':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
      case 'accounts-receivable':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
      case 'general-ledger':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
      case 'cost-tracking':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />
      case 'budgets':
        return isEnabled ? <ModuleComingSoon moduleName={viewNames[activeView]} /> : <ModuleDisabled moduleName={viewNames[activeView]} />

      // ============================================
      // INTEGRATIONS
      // ============================================
      case 'google-drive':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <GoogleDriveView />
          </Suspense>
        ) : <ModuleDisabled moduleName={viewNames[activeView]} />

      // ============================================
      // SYSTEM
      // ============================================
      case 'terminal':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <TerminalView onRefresh={onRefresh} />
          </Suspense>
        ) : <ModuleDisabled moduleName={viewNames[activeView]} />
        
      default:
        // Default to explorer if enabled, otherwise show disabled message
        return isModuleVisible('explorer', moduleConfig) ? (
          <Suspense fallback={<ViewLoading />}>
            <ExplorerView onOpenVault={onOpenVault} onOpenRecentVault={onOpenRecentVault} />
          </Suspense>
        ) : <ModuleDisabled moduleName="Explorer" />
    }
  }

  const getTitle = () => {
    switch (activeView) {
      // Source Files
      case 'explorer':
        return 'EXPLORER'
      case 'pending':
        return 'PENDING'
      case 'history':
        return 'HISTORY'
      case 'workflows':
        return 'FILE WORKFLOWS'
      case 'trash':
        return 'TRASH'
      // Items
      case 'items':
        return 'ITEM BROWSER'
      case 'boms':
        return 'BOMS'
      case 'products':
        return 'PRODUCTS'
      // Change Control
      case 'ecr':
        return 'ECRS / ISSUES'
      case 'eco':
        return 'ECOS'
      case 'notifications':
        return 'NOTIFICATIONS'
      case 'deviations':
        return 'DEVIATIONS'
      case 'release-schedule':
        return 'RELEASE SCHEDULE'
      case 'process':
        return 'PROCESS EDITOR'
      // Supply Chain - Suppliers
      case 'supplier-database':
        return 'SUPPLIER DATABASE'
      case 'supplier-portal':
        return 'SUPPLIER PORTAL'
      // Supply Chain - Purchasing
      case 'purchase-requests':
        return 'PURCHASE REQUESTS'
      case 'purchase-orders':
        return 'PURCHASE ORDERS'
      case 'invoices':
        return 'INVOICES'
      // Supply Chain - Logistics
      case 'shipping':
        return 'SHIPPING'
      case 'receiving':
        return 'RECEIVING'
      // Production
      case 'manufacturing-orders':
        return 'MANUFACTURING ORDERS'
      case 'travellers':
        return 'TRAVELLERS'
      case 'work-instructions':
        return 'WORK INSTRUCTIONS'
      case 'production-schedule':
        return 'PRODUCTION SCHEDULE'
      case 'routings':
        return 'ROUTINGS'
      case 'work-centers':
        return 'WORK CENTERS'
      case 'process-flows':
        return 'PROCESS FLOWS'
      case 'equipment':
        return 'EQUIPMENT'
      // Production - Analytics
      case 'yield-tracking':
        return 'YIELD TRACKING'
      case 'error-codes':
        return 'ERROR CODES'
      case 'downtime':
        return 'DOWNTIME'
      case 'oee':
        return 'OEE DASHBOARD'
      case 'scrap-tracking':
        return 'SCRAP TRACKING'
      // Quality
      case 'fai':
        return 'FIRST ARTICLE INSPECTION (FAI)'
      case 'ncr':
        return 'NON-CONFORMANCE REPORT (NCR)'
      case 'imr':
        return 'INCOMING MATERIAL REPORT (IMR)'
      case 'scar':
        return 'SUPPLIER CORRECTIVE ACTION (SCAR)'
      case 'capa':
        return 'CORRECTIVE & PREVENTIVE ACTION (CAPA)'
      case 'rma':
        return 'RETURN MATERIAL AUTHORIZATION (RMA)'
      case 'certificates':
        return 'CERTIFICATES'
      case 'calibration':
        return 'CALIBRATION'
      case 'quality-templates':
        return 'TEMPLATES'
      // Accounting
      case 'accounts-payable':
        return 'ACCOUNTS PAYABLE'
      case 'accounts-receivable':
        return 'ACCOUNTS RECEIVABLE'
      case 'general-ledger':
        return 'GENERAL LEDGER'
      case 'cost-tracking':
        return 'COST TRACKING'
      case 'budgets':
        return 'BUDGETS'
      // Integrations
      case 'google-drive':
        return 'GOOGLE DRIVE'
      // System
      case 'terminal':
        return 'TERMINAL'
      case 'settings':
        return 'SETTINGS'
      default:
        return ''
    }
  }

  return (
    <div
      className="bg-plm-sidebar flex flex-col overflow-hidden"
      style={{ width: effectiveWidth }}
    >
      {/* Sidebar header - compact uppercase style for all views */}
      <div className="sidebar-header h-9 flex items-center justify-between px-4 text-[11px] font-semibold text-plm-fg-dim tracking-wide border-b border-plm-border">
        <span>{getTitle()}</span>
        {activeView === 'explorer' && connectedVaults.length > 0 && (
          <span className="text-plm-fg-muted font-normal">
            {connectedVaults.length} vault{connectedVaults.length > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        {renderView()}
      </div>
    </div>
  )
}
