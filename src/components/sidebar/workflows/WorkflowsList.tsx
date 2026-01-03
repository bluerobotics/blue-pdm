// WorkflowsList - List of workflows with selection
import { memo } from 'react'
import { Plus, GitBranch, Loader2 } from 'lucide-react'
import { WorkflowCard } from './WorkflowCard'
import type { WorkflowTemplate } from './types'

interface WorkflowsListProps {
  workflows: WorkflowTemplate[]
  selectedWorkflowId: string | null
  isLoading: boolean
  isAdmin: boolean
  onSelectWorkflow: (workflow: WorkflowTemplate) => void
  onEditWorkflow: (workflow: WorkflowTemplate) => void
  onCreateWorkflow: () => void
}

export const WorkflowsList = memo(function WorkflowsList({
  workflows,
  selectedWorkflowId,
  isLoading,
  isAdmin,
  onSelectWorkflow,
  onEditWorkflow,
  onCreateWorkflow
}: WorkflowsListProps) {
  return (
    <div className="border-r border-plm-border w-48 flex-shrink-0 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-plm-border">
        <div className="flex items-center gap-1.5">
          <GitBranch size={14} className="text-plm-fg-muted" />
          <span className="text-xs font-medium text-plm-fg-muted">Workflows</span>
        </div>
        {isAdmin && (
          <button
            onClick={onCreateWorkflow}
            className="p-1 hover:bg-plm-bg rounded"
            title="Create workflow"
          >
            <Plus size={14} />
          </button>
        )}
      </div>
      
      {/* List */}
      <div className="flex-1 overflow-y-auto p-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 size={16} className="animate-spin text-plm-fg-muted" />
          </div>
        ) : workflows.length === 0 ? (
          <div className="text-center py-4 text-xs text-plm-fg-muted">
            No workflows
          </div>
        ) : (
          workflows.map(workflow => (
            <WorkflowCard
              key={workflow.id}
              workflow={workflow}
              isSelected={workflow.id === selectedWorkflowId}
              onSelect={() => onSelectWorkflow(workflow)}
              onEdit={() => onEditWorkflow(workflow)}
              isAdmin={isAdmin}
            />
          ))
        )}
      </div>
    </div>
  )
})
