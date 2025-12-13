import { Plug, MessageSquare, ShoppingCart, Settings } from 'lucide-react'

interface IntegrationCardProps {
  icon: React.ReactNode
  name: string
  description: string
  connected?: boolean
}

function IntegrationCard({ icon, name, description, connected }: IntegrationCardProps) {
  return (
    <div className="flex items-start gap-3 p-3 bg-pdm-highlight rounded hover:bg-pdm-highlight/80 transition-colors cursor-pointer">
      <div className="w-10 h-10 rounded-lg bg-pdm-bg flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-pdm-fg">{name}</span>
          {connected && (
            <span className="px-1.5 py-0.5 text-[9px] font-medium bg-pdm-success/20 text-pdm-success rounded">
              CONNECTED
            </span>
          )}
        </div>
        <p className="text-xs text-pdm-fg-muted mt-0.5 line-clamp-2">{description}</p>
      </div>
    </div>
  )
}

export function IntegrationsView() {
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 space-y-3">
        <IntegrationCard
          icon={<MessageSquare size={20} className="text-[#4A154B]" />}
          name="Slack"
          description="Approval reminders, review notifications, ECO channels"
        />
        <IntegrationCard
          icon={<ShoppingCart size={20} className="text-[#714B67]" />}
          name="Odoo"
          description="ECO release export with item change manifest metadata"
        />
        <IntegrationCard
          icon={<Settings size={20} className="text-pdm-fg-muted" />}
          name="Webhooks"
          description="Custom integrations via HTTP webhooks"
        />
      </div>
      
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-pdm-highlight flex items-center justify-center mb-4">
          <Plug size={32} className="text-pdm-fg-muted" />
        </div>
        <h3 className="text-sm font-medium text-pdm-fg mb-2">Integrations Hub</h3>
        <p className="text-xs text-pdm-fg-muted max-w-[200px]">
          Connect external services for automations, notifications, and data sync.
        </p>
        <div className="mt-6 px-3 py-1.5 bg-pdm-warning/20 text-pdm-warning text-[10px] font-medium rounded">
          COMING SOON
        </div>
      </div>
    </div>
  )
}

