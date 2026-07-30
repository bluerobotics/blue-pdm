import { ArrowLeft, Users } from 'lucide-react'

import { SyncStatusLine } from './SyncControl'

/**
 * Full-page state for an org that has never run the sync.
 *
 * There is no button here on purpose. The sync control lives in the sidebar,
 * where it is reachable in both the empty and the populated state; a second
 * copy on this screen meant two buttons that did not know about each other.
 */
export function FirstRunHero() {
  return (
    <div className="h-full overflow-auto flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="w-10 h-10 rounded-lg bg-plm-accent/15 flex items-center justify-center mx-auto mb-3">
          <Users size={20} className="text-plm-accent" />
        </div>

        <h2 className="text-base font-semibold text-plm-fg">No customer data yet</h2>
        <p className="text-sm text-plm-fg-muted mt-1">
          This workspace reads from a mirror of your Odoo. Nothing is ever written back.
        </p>

        <div className="mt-5 flex items-center justify-center gap-2 text-xs text-plm-fg-muted">
          <ArrowLeft size={13} />
          <span>
            Use <span className="text-plm-fg">Sync from Odoo</span> in the sidebar to fill it.
          </span>
        </div>

        <div className="mt-5 flex justify-center">
          <SyncStatusLine />
        </div>
      </div>
    </div>
  )
}
