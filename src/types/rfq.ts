// RFQ (Request for Quote) Types for Supplier Portal

export type RFQStatus = 
  | 'draft'
  | 'pending_files'
  | 'generating'
  | 'ready'
  | 'sent'
  | 'awaiting_quote'
  | 'quoted'
  | 'awarded'
  | 'cancelled'
  | 'completed'

export interface RFQ {
  id: string
  org_id: string
  
  // Identity
  rfq_number: string
  title: string
  description: string | null
  
  // Status
  status: RFQStatus
  
  // Dates
  due_date: string | null
  required_date: string | null
  valid_until: string | null
  
  // Options
  requires_samples: boolean
  requires_first_article: boolean
  requires_quality_report: boolean
  allow_partial_quotes: boolean
  
  // File generation
  release_files_generated: boolean
  release_files_generated_at: string | null
  release_folder_path: string | null
  
  // Addresses (references to organization_addresses)
  billing_address_id: string | null
  shipping_address_id: string | null
  
  // Shipping
  shipping_address: string | null
  shipping_notes: string | null
  incoterms: string | null
  
  // Notes
  internal_notes: string | null
  supplier_notes: string | null
  
  // Metadata
  created_at: string
  created_by: string
  updated_at: string
  updated_by: string | null
  sent_at: string | null
  sent_by: string | null
  completed_at: string | null
  
  // Joined data (when fetched with relations)
  items?: RFQItem[]
  suppliers?: RFQSupplier[]
  created_by_user?: {
    id: string
    email: string
    full_name: string | null
    avatar_url: string | null
  }
}

export interface RFQItem {
  id: string
  rfq_id: string
  
  // Item details
  line_number: number
  file_id: string | null
  
  // Identification
  part_number: string
  description: string | null
  revision: string | null
  
  // Quantity
  quantity: number
  unit: string
  
  // Material specs
  material: string | null
  finish: string | null
  tolerance_class: string | null
  special_requirements: string | null
  
  // SolidWorks configuration for export
  sw_configuration: string | null
  
  // Release files
  step_file_path: string | null
  pdf_file_path: string | null
  step_file_generated: boolean
  pdf_file_generated: boolean
  step_file_size: number | null
  pdf_file_size: number | null
  step_storage_path: string | null
  pdf_storage_path: string | null
  
  // Attachments
  attachments: RFQAttachment[]
  notes: string | null
  
  // Timestamps
  created_at: string
  updated_at: string
  
  // Joined data
  file?: {
    id: string
    file_name: string
    file_path: string
    part_number: string | null
    description: string | null
    revision: string
    version: number
    file_type: string
    extension: string
  }
}

export interface RFQAttachment {
  name: string
  path: string
  size: number
  storage_path?: string
}

export interface RFQSupplier {
  id: string
  rfq_id: string
  supplier_id: string
  
  // Status
  sent_at: string | null
  viewed_at: string | null
  quoted_at: string | null
  declined_at: string | null
  declined_reason: string | null
  
  // Quote summary
  total_quoted_amount: number | null
  currency: string
  lead_time_days: number | null
  
  // Selection
  is_selected: boolean
  selected_at: string | null
  selected_by: string | null
  
  notes: string | null
  created_at: string
  
  // Joined data
  supplier?: {
    id: string
    name: string
    code: string | null
    contact_email: string | null
    contact_name: string | null
  }
  quotes?: RFQQuote[]
}

export interface RFQQuote {
  id: string
  rfq_id: string
  rfq_supplier_id: string
  rfq_item_id: string
  
  // Pricing
  unit_price: number | null
  currency: string
  tooling_cost: number | null
  price_breaks: PriceBreak[]
  lead_time_days: number | null
  
  // Notes
  notes: string | null
  can_quote: boolean
  cannot_quote_reason: string | null
  
  // Timestamps
  created_at: string
  updated_at: string
}

export interface PriceBreak {
  qty: number
  price: number
}

export interface RFQActivity {
  id: string
  rfq_id: string
  action: string
  description: string | null
  user_id: string | null
  supplier_id: string | null
  details: Record<string, unknown>
  created_at: string
  
  // Joined data
  user?: {
    email: string
    full_name: string | null
  }
  supplier?: {
    name: string
    code: string | null
  }
}

export interface RFQSummary {
  total_items: number
  total_quantity: number
  suppliers_invited: number
  suppliers_quoted: number
  lowest_quote: number | null
  highest_quote: number | null
}

// Status display info
export const RFQ_STATUS_INFO: Record<RFQStatus, { 
  label: string
  color: string
  bgColor: string
  description: string 
}> = {
  draft: {
    label: 'Draft',
    color: 'text-plm-fg-muted',
    bgColor: 'bg-plm-fg-muted/20',
    description: 'RFQ is being prepared'
  },
  pending_files: {
    label: 'Pending Files',
    color: 'text-plm-warning',
    bgColor: 'bg-plm-warning/20',
    description: 'Files need to be added'
  },
  generating: {
    label: 'Generating',
    color: 'text-plm-info',
    bgColor: 'bg-plm-info/20',
    description: 'Release files are being generated'
  },
  ready: {
    label: 'Ready',
    color: 'text-plm-success',
    bgColor: 'bg-plm-success/20',
    description: 'Ready to send to suppliers'
  },
  sent: {
    label: 'Sent',
    color: 'text-blue-400',
    bgColor: 'bg-blue-400/20',
    description: 'Sent to suppliers'
  },
  awaiting_quote: {
    label: 'Awaiting',
    color: 'text-plm-warning',
    bgColor: 'bg-plm-warning/20',
    description: 'Waiting for supplier responses'
  },
  quoted: {
    label: 'Quoted',
    color: 'text-plm-info',
    bgColor: 'bg-plm-info/20',
    description: 'All quotes received'
  },
  awarded: {
    label: 'Awarded',
    color: 'text-plm-success',
    bgColor: 'bg-plm-success/20',
    description: 'Contract awarded'
  },
  cancelled: {
    label: 'Cancelled',
    color: 'text-plm-error',
    bgColor: 'bg-plm-error/20',
    description: 'RFQ was cancelled'
  },
  completed: {
    label: 'Completed',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-400/20',
    description: 'Order completed'
  }
}

// Helper to get status info
export function getRFQStatusInfo(status: RFQStatus) {
  return RFQ_STATUS_INFO[status] || RFQ_STATUS_INFO.draft
}

// Format currency
export function formatCurrency(amount: number | null, currency: string = 'USD'): string {
  if (amount === null) return '-'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount)
}

// Calculate line total
export function calculateLineTotal(unitPrice: number | null, quantity: number): number | null {
  if (unitPrice === null) return null
  return unitPrice * quantity
}

// Calculate RFQ total from quotes
export function calculateRFQTotal(items: RFQItem[], quotes: RFQQuote[]): number {
  let total = 0
  for (const item of items) {
    const quote = quotes.find(q => q.rfq_item_id === item.id && q.can_quote)
    if (quote?.unit_price) {
      total += quote.unit_price * item.quantity
      if (quote.tooling_cost) {
        total += quote.tooling_cost
      }
    }
  }
  return total
}

