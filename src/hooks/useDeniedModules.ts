import { useMemo } from 'react'
import { usePDMStore } from '@/stores/pdmStore'
import type { ModuleId } from '@/types/modules'

const NO_DENIED_MODULES: ReadonlySet<ModuleId> = new Set()

/**
 * Modules the current user is restricted out of, as a set suitable for passing
 * to isModuleVisible().
 *
 * The store keeps the denied list as an array so the reference stays stable
 * between loads; this memoises the Set on top of it. Admins and users with no
 * restrictions share one frozen empty Set, which keeps the common case free of
 * allocations and keeps useMemo dependencies downstream stable.
 */
export function useDeniedModules(): ReadonlySet<ModuleId> {
  const deniedModules = usePDMStore((s) => s.deniedModules)

  return useMemo(
    () => (deniedModules.length === 0 ? NO_DENIED_MODULES : new Set(deniedModules)),
    [deniedModules],
  )
}
