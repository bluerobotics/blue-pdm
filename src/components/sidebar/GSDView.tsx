import { FileText, CheckCircle2, Clock, AlertTriangle } from 'lucide-react'

export function GSDView() {
  return (
    <div className="flex flex-col h-full">
      {/* Quick stats header */}
      <div className="p-4 border-b border-pdm-border">
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col items-center p-2 bg-pdm-highlight rounded">
            <CheckCircle2 size={14} className="text-pdm-success mb-1" />
            <span className="text-lg font-bold text-pdm-fg">0</span>
            <span className="text-[9px] text-pdm-fg-muted">Done</span>
          </div>
          <div className="flex flex-col items-center p-2 bg-pdm-highlight rounded">
            <Clock size={14} className="text-pdm-info mb-1" />
            <span className="text-lg font-bold text-pdm-fg">0</span>
            <span className="text-[9px] text-pdm-fg-muted">In Progress</span>
          </div>
          <div className="flex flex-col items-center p-2 bg-pdm-highlight rounded">
            <AlertTriangle size={14} className="text-pdm-warning mb-1" />
            <span className="text-lg font-bold text-pdm-fg">0</span>
            <span className="text-[9px] text-pdm-fg-muted">Blocked</span>
          </div>
        </div>
      </div>
      
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-pdm-highlight flex items-center justify-center mb-4">
          <FileText size={32} className="text-pdm-fg-muted" />
        </div>
        <h3 className="text-sm font-medium text-pdm-fg mb-2">GSD Summary</h3>
        <p className="text-xs text-pdm-fg-muted max-w-[200px]">
          Getting Stuff Done — your ECO dashboard. Track progress, blockers, and what needs attention.
        </p>
        <div className="mt-6 px-3 py-1.5 bg-pdm-warning/20 text-pdm-warning text-[10px] font-medium rounded">
          COMING SOON
        </div>
      </div>
    </div>
  )
}

