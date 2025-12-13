import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'

export function ScheduleView() {
  const today = new Date()
  const monthName = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-pdm-border">
        <div className="flex items-center justify-between">
          <button className="p-1 hover:bg-pdm-highlight rounded text-pdm-fg-muted hover:text-pdm-fg">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-medium text-pdm-fg">{monthName}</span>
          <button className="p-1 hover:bg-pdm-highlight rounded text-pdm-fg-muted hover:text-pdm-fg">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-pdm-highlight flex items-center justify-center mb-4">
          <Calendar size={32} className="text-pdm-fg-muted" />
        </div>
        <h3 className="text-sm font-medium text-pdm-fg mb-2">ECO Schedule</h3>
        <p className="text-xs text-pdm-fg-muted max-w-[200px]">
          Timeline view of ECO milestones, deadlines, and release dates. Plan and track change implementation.
        </p>
        <div className="mt-6 px-3 py-1.5 bg-pdm-warning/20 text-pdm-warning text-[10px] font-medium rounded">
          COMING SOON
        </div>
      </div>
    </div>
  )
}

