/**
 * The one banner that reports a SolidWorks service the app cannot fully use.
 *
 * It lived inline in the Integrations > SOLIDWORKS > Service tab, which is where an admin goes to
 * ask about the service. Anything that refuses to run because the service is stale has to say so
 * where the refusal happens, and it has to say it in the same words - a second wording invented at
 * the point of failure is how "Service is up to date" and "this feature cannot run" end up on
 * screen at the same time.
 *
 * Renders nothing when the service is current or ahead, so callers can hand it a check
 * unconditionally.
 */

import { AlertTriangle } from 'lucide-react'

import type { SwServiceVersionCheckResult } from '@/lib/swServiceVersion'

export interface SwServiceVersionNoticeProps {
  check: SwServiceVersionCheckResult
  /**
   * What the caller in particular cannot do until the service is rebuilt. The check itself only
   * knows the version is behind; the page knows what that costs the person reading it.
   */
  requirement?: string
}

export function SwServiceVersionNotice({ check, requirement }: SwServiceVersionNoticeProps) {
  if (check.status === 'current' || check.status === 'ahead') return null

  const blocking = check.status === 'incompatible'

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border ${
        blocking ? 'bg-red-500/10 border-red-500/30' : 'bg-yellow-500/10 border-yellow-500/30'
      }`}
    >
      <AlertTriangle
        size={16}
        className={`mt-0.5 flex-shrink-0 ${blocking ? 'text-red-400' : 'text-yellow-400'}`}
      />
      <div className="flex-1">
        <div className={`text-sm font-medium ${blocking ? 'text-red-400' : 'text-yellow-400'}`}>
          {check.message}
        </div>
        {requirement && <div className="text-xs text-plm-fg-muted mt-1">{requirement}</div>}
        <div className="text-xs text-plm-fg-muted mt-1">{check.details}</div>
      </div>
    </div>
  )
}
