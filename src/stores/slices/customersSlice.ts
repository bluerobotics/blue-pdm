import { StateCreator } from 'zustand'

import type {
  PDMStoreState,
  CustomersSlice,
  CustomerFilters,
  CustomerSyncState,
} from '../types'

/**
 * Filters are deliberately NOT persisted.
 *
 * Cross-filter chips accumulate as you click through charts, and restoring a
 * half-drilled-in state days later reads as "the dashboard is broken" rather
 * than "this is where you left off". Only the selected tab survives a restart.
 */
export const DEFAULT_CUSTOMER_FILTERS: CustomerFilters = {
  range: '12m',
  bucket: 'month',
  search: '',
  segments: [],
  categories: [],
  countries: [],
  channels: [],
  presence: 'all',
}

/**
 * Sync state starts empty and is never persisted: a run belongs to the server,
 * so the truth is re-read from GET /customers/sync/status on mount rather than
 * restored from a stale snapshot on disk.
 */
const IDLE_SYNC: CustomerSyncState = {
  active: false,
  stopping: false,
  run: null,
  result: null,
  error: null,
}

export const createCustomersSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  CustomersSlice
> = (set) => ({
  // State
  customersTab: 'overview',
  customerFilters: { ...DEFAULT_CUSTOMER_FILTERS },
  customerPanel: null,
  customerDataVersion: 0,
  customerSync: { ...IDLE_SYNC },

  // Actions
  setCustomersTab: (customersTab) => set({ customersTab }),

  invalidateCustomerData: () =>
    set((state) => ({ customerDataVersion: state.customerDataVersion + 1 })),

  setCustomerFilters: (patch) =>
    set((state) => ({ customerFilters: { ...state.customerFilters, ...patch } })),

  toggleCustomerFacet: (facet, value) =>
    set((state) => {
      const current = state.customerFilters[facet]
      const next = current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value]
      return { customerFilters: { ...state.customerFilters, [facet]: next } }
    }),

  resetCustomerFilters: () =>
    set((state) => ({
      // The date window and bucket are a viewing preference rather than a
      // filter, so "clear filters" leaves the period the user chose alone.
      customerFilters: {
        ...DEFAULT_CUSTOMER_FILTERS,
        range: state.customerFilters.range,
        bucket: state.customerFilters.bucket,
      },
    })),

  setCustomerPanel: (customerPanel) => set({ customerPanel }),

  setCustomerSync: (patch) =>
    set((state) => ({ customerSync: { ...state.customerSync, ...patch } })),
})
