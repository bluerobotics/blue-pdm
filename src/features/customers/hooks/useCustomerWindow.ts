import { useMemo } from 'react'

import { usePDMStore } from '@/stores/pdmStore'

import { resolveWindow, type ResolvedWindow } from '../lib/ranges'

/**
 * The date range every surface in the workspace is scoped to.
 *
 * The sidebar, the tables, the charts and the detail panel are separate React
 * subtrees with nothing above them but the store, so each resolves the window
 * for itself. Going through one hook is what keeps them from disagreeing, and
 * memoizing on the preset is what stops the window resolving to fresh ISO
 * strings on every render and looping the effects that depend on it.
 *
 * The resulting `from`/`to` are part of every cache key, so switching range and
 * switching back paints from the previous load rather than refetching.
 */
export function useCustomerWindow(): ResolvedWindow {
  const range = usePDMStore((s) => s.customerFilters.range)

  return useMemo(() => resolveWindow(range), [range])
}
