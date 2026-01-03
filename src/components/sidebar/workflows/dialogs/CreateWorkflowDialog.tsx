// Create Workflow Dialog Component
import { useState } from 'react'
import type { CreateWorkflowDialogProps } from '../types'

export function CreateWorkflowDialog({ onClose, onCreate }: CreateWorkflowDialogProps) {
  const [name, setName] = useState('New Workflow')
  const [description, setDescription] = useState('')
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-plm-sidebar rounded-lg shadow-xl w-96 p-4">
        <h3 className="font-semibold mb-4">Create Workflow</h3>
        
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
        </div>
        
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm hover:bg-plm-bg rounded"
          >
            Cancel
          </button>
          <button
            onClick={() => onCreate(name, description)}
            className="px-3 py-1.5 text-sm bg-plm-accent hover:bg-plm-accent-hover text-white rounded"
            disabled={!name.trim()}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
