// Edit Workflow Dialog Component
import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { EditWorkflowDialogProps } from '../types'

export function EditWorkflowDialog({ workflow, onClose, onSave, onDelete }: EditWorkflowDialogProps) {
  const [name, setName] = useState(workflow.name)
  const [description, setDescription] = useState(workflow.description || '')
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-plm-sidebar rounded-lg shadow-xl w-96 p-4">
        <h3 className="font-semibold mb-4">Edit Workflow</h3>
        
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-plm-fg-muted mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-plm-input border border-plm-border rounded px-2 py-1.5 text-sm"
              autoFocus
            />
          </div>
          
          <div>
            <label className="block text-xs text-plm-fg-muted mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-plm-input border border-plm-border rounded px-2 py-1.5 text-sm h-20 resize-none"
              placeholder="Optional description..."
            />
          </div>
          
          {workflow.is_default && (
            <p className="text-xs text-plm-fg-muted bg-plm-bg-light rounded p-2">
              This is the default workflow for new files.
            </p>
          )}
        </div>
        
        <div className="flex justify-between mt-4">
          <button
            onClick={onDelete}
            className="px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/20 rounded"
            title="Delete this workflow"
          >
            <Trash2 size={14} className="inline mr-1" />
            Delete
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm hover:bg-plm-bg rounded"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(name, description)}
              className="px-3 py-1.5 text-sm bg-plm-accent hover:bg-plm-accent-hover text-white rounded"
              disabled={!name.trim()}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
