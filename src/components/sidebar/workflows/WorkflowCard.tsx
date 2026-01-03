// WorkflowCard - Single workflow item in the list
import { memo } from 'react'
import { GitBranch, Edit3 } from 'lucide-react'
import type { WorkflowTemplate } from './types'

interface WorkflowCardProps {
  workflow: WorkflowTemplate
  isSelected: boolean
  onSelect: () => void
  onEdit: () => void
  isAdmin: boolean
}

export const WorkflowCard = memo(function WorkflowCard({
  workflow,
  isSelected,
  onSelect,
  onEdit,
  isAdmin
}: WorkflowCardProps) {
  return (
    <div
      className={`px-2 py-1.5 rounded cursor-pointer flex items-center justify-between group ${
        isSelected ? 'bg-plm-accent/20' : 'hover:bg-plm-bg'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <GitBranch size={14} className={workflow.is_default ? 'text-plm-accent' : 'text-plm-fg-muted'} />
        <span className="text-sm truncate">{workflow.name}</span>
        {workflow.is_default && (
          <span className="text-[10px] bg-plm-accent/20 text-plm-accent px-1.5 py-0.5 rounded">
            Default
          </span>
        )}
      </div>
      {isAdmin && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-plm-highlight rounded transition-opacity"
          title="Edit workflow"
        >
          <Edit3 size={12} />
        </button>
      )}
    </div>
  )
})
