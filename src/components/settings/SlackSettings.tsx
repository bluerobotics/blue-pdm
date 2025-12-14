import { MessageSquare, Puzzle } from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'

export function SlackSettings() {
  const { user } = usePDMStore()

  if (user?.role !== 'admin') {
    return (
      <div className="text-center py-12">
        <Puzzle size={40} className="mx-auto mb-4 text-pdm-fg-muted opacity-50" />
        <p className="text-base text-pdm-fg-muted">
          Only administrators can manage Slack integration.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-lg bg-[#4A154B] flex items-center justify-center">
          <MessageSquare size={24} className="text-white" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-medium text-pdm-fg">Slack</h3>
          <p className="text-sm text-pdm-fg-muted">
            Approval reminders, review notifications, ECO channels
          </p>
        </div>
        <span className="px-2 py-1 text-xs font-medium bg-pdm-fg-muted/20 text-pdm-fg-muted rounded">
          COMING SOON
        </span>
      </div>
      
      <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-border">
        <p className="text-sm text-pdm-fg-muted">
          Slack integration will enable:
        </p>
        <ul className="mt-2 text-sm text-pdm-fg-muted list-disc list-inside space-y-1">
          <li>Automatic notifications for pending approvals</li>
          <li>ECO status updates in dedicated channels</li>
          <li>Review reminders and escalations</li>
          <li>File check-in/check-out alerts</li>
        </ul>
      </div>
    </div>
  )
}

