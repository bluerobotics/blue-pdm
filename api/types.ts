/**
 * BluePLM API Type Definitions
 *
 * Shared types for the API server, routes, and middleware.
 */

import type { FastifyReply, FastifyRequest } from 'fastify'
import { SupabaseClient } from '@supabase/supabase-js'

// ============================================
// Core Entity Types
// ============================================

export interface UserProfile {
  id: string
  email: string
  full_name: string | null
  role: 'admin' | 'engineer' | 'viewer'
  org_id: string | null
}

export interface FileRecord {
  id: string
  org_id: string
  vault_id: string
  file_path: string
  file_name: string
  extension: string
  file_type: 'part' | 'assembly' | 'drawing' | 'document' | 'other'
  part_number: string | null
  description: string | null
  revision: string
  version: number
  content_hash: string
  file_size: number
  state: 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'
  checked_out_by: string | null
  checked_out_at: string | null
  lock_message: string | null
  deleted_at: string | null
  deleted_by: string | null
  created_at: string
  updated_at: string
  created_by: string
  updated_by: string
}

// ============================================
// Webhook Types
// ============================================

export interface Webhook {
  id: string
  org_id: string
  url: string
  secret: string
  events: WebhookEvent[]
  active: boolean
  created_at: string
  created_by: string
}

export type WebhookEvent =
  | 'file.checkout'
  | 'file.checkin'
  | 'file.sync'
  | 'file.delete'
  | 'file.restore'
  | 'file.state_change'
  | 'file.version'

export interface WebhookPayload {
  event: WebhookEvent
  timestamp: string
  org_id: string
  data: {
    file_id?: string
    file_path?: string
    file_name?: string
    user_id?: string
    user_email?: string
    [key: string]: unknown
  }
}

// ============================================
// Supplier Types
// ============================================

export interface Supplier {
  id: string
  org_id: string
  name: string
  code: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  website: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  country: string
  payment_terms: string | null
  default_lead_time_days: number | null
  min_order_value: number | null
  currency: string
  shipping_account: string | null
  is_active: boolean
  is_approved: boolean
  notes: string | null
  erp_id: string | null
  created_at: string
  updated_at: string
}

export interface PartSupplier {
  id: string
  org_id: string
  file_id: string
  supplier_id: string
  supplier_part_number: string | null
  supplier_description: string | null
  supplier_url: string | null
  unit_price: number | null
  currency: string
  price_unit: string
  price_breaks: PriceBreak[]
  min_order_qty: number
  order_multiple: number
  lead_time_days: number | null
  is_preferred: boolean
  is_active: boolean
  is_qualified: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface PriceBreak {
  qty: number
  price: number
}

// ============================================
// Odoo Integration Types
// ============================================

export interface OdooSupplier {
  id: number
  name: string
  ref: string | false
  email: string | false
  phone: string | false
  mobile: string | false
  website: string | false
  street: string | false
  street2: string | false
  city: string | false
  zip: string | false
  state_id: [number, string] | false
  country_id: [number, string] | false
  active: boolean
}

export interface OdooFetchResult {
  success: boolean
  suppliers: OdooSupplier[]
  error?: string
  debug: {
    url: string
    auth_uid: unknown
    supplier_ids_count: number
    supplier_ids_type: string
    suppliers_result_type: string
    suppliers_count: number
    timing_ms: number
    raw_xml_samples?: string[]
  }
}

export interface OdooConnectionResult {
  success: boolean
  user_name?: string
  version?: string
  error?: string
}

// ============================================
// Fastify Extensions
// ============================================

/**
 * Guard added by `authPlugin` and applied as an `onRequest` hook by protected routes.
 *
 * Declared at file scope rather than inline in the augmentation below: names used
 * inside a `declare module` block resolve against the ambient type graph, not this
 * file's imports, so an inline `FastifyReply` compiled only as a side effect of some
 * other installed package pulling Fastify's types into scope. Naming the type here
 * makes the augmentation depend on an explicit import instead.
 */
export type AuthenticateHook = (request: FastifyRequest, reply: FastifyReply) => Promise<void>

declare module 'fastify' {
  interface FastifyRequest {
    user: UserProfile | null
    supabase: SupabaseClient | null
    accessToken: string | null
  }

  interface FastifyInstance {
    authenticate: AuthenticateHook
  }
}
