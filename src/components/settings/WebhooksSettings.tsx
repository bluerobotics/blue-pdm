import { Plug, Puzzle } from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'

export function WebhooksSettings() {
  const { user } = usePDMStore()

  if (user?.role !== 'admin') {
    return (
      <div className="text-center py-12">
        <Puzzle size={40} className="mx-auto mb-4 text-pdm-fg-muted opacity-50" />
        <p className="text-base text-pdm-fg-muted">
          Only administrators can manage webhook settings.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-lg bg-pdm-sidebar flex items-center justify-center">
          <Plug size={24} className="text-pdm-fg-muted" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-medium text-pdm-fg">Webhooks</h3>
          <p className="text-sm text-pdm-fg-muted">
            Custom integrations via HTTP webhooks
          </p>
        </div>
        <span className="px-2 py-1 text-xs font-medium bg-pdm-fg-muted/20 text-pdm-fg-muted rounded">
          COMING SOON
        </span>
      </div>
      
      <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-border">
        <p className="text-sm text-pdm-fg-muted">
          Webhooks will allow you to:
        </p>
        <ul className="mt-2 text-sm text-pdm-fg-muted list-disc list-inside space-y-1">
          <li>Trigger external workflows on file events</li>
          <li>Send data to your custom endpoints</li>
          <li>Integrate with any HTTP-compatible service</li>
        </ul>
      </div>
    </div>
  )
}

