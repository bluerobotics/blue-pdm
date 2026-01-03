// Edit Transition Dialog Component
import { useState, useEffect } from 'react'
import { BadgeCheck, CheckCircle } from 'lucide-react'
import { usePDMStore } from '../../../../stores/pdmStore'
import { supabase } from '../../../../lib/supabase'
import type { EditTransitionDialogProps, WorkflowRoleBasic, TransitionLineStyle } from '../types'

export function EditTransitionDialog({ transition, onClose, onSave }: EditTransitionDialogProps) {
  const { organization } = usePDMStore()
  const [name, setName] = useState(transition.name || '')
  const [description, setDescription] = useState(transition.description || '')
  const [lineStyle, setLineStyle] = useState<TransitionLineStyle>(transition.line_style)
  const [allowedWorkflowRoles, setAllowedWorkflowRoles] = useState<string[]>(transition.allowed_workflow_roles || [])
  
  // Load workflow roles
  const [workflowRoles, setWorkflowRoles] = useState<WorkflowRoleBasic[]>([])
  const [loadingRoles, setLoadingRoles] = useState(true)
  
  useEffect(() => {
    const loadRoles = async () => {
      if (!organization) return
      try {
        const { data, error } = await supabase
          .from('workflow_roles')
          .select('id, name, color, icon')
          .eq('org_id', organization.id)
          .eq('is_active', true)
          .order('sort_order')
          .order('name')
        
        if (!error && data) {
          setWorkflowRoles(data)
        }
      } catch (err) {
        console.error('Failed to load workflow roles:', err)
      } finally {
        setLoadingRoles(false)
      }
    }
    loadRoles()
  }, [organization])
  
  const toggleWorkflowRole = (roleId: string) => {
    if (allowedWorkflowRoles.includes(roleId)) {
      setAllowedWorkflowRoles(allowedWorkflowRoles.filter(id => id !== roleId))
    } else {
      setAllowedWorkflowRoles([...allowedWorkflowRoles, roleId])
    }
  }
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-plm-sidebar rounded-lg shadow-xl w-[420px] max-h-[80vh] overflow-auto p-4">
        <h3 className="font-semibold mb-4">Edit Transition</h3>
        
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-plm-fg-muted mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-plm-input border border-plm-border rounded px-2 py-1.5 text-sm"
              placeholder="e.g., Submit for Review"
            />
          </div>
          
          <div>
            <label className="block text-xs text-plm-fg-muted mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-plm-input border border-plm-border rounded px-2 py-1.5 text-sm h-16 resize-none"
            />
          </div>
          
          <div>
            <label className="block text-xs text-plm-fg-muted mb-1">Line Style</label>
            <div className="flex gap-2">
              {(['solid', 'dashed', 'dotted'] as TransitionLineStyle[]).map(style => (
                <button
                  key={style}
                  onClick={() => setLineStyle(style)}
                  className={`px-3 py-1.5 rounded text-sm ${
                    lineStyle === style ? 'bg-plm-accent text-white' : 'bg-plm-bg hover:bg-plm-highlight'
                  }`}
                >
                  {style}
                </button>
              ))}
            </div>
          </div>
          
          {/* Workflow Roles */}
          <div>
            <label className="block text-xs text-plm-fg-muted mb-1">
              Allowed Workflow Roles
              <span className="text-plm-fg-muted/60 ml-1">(optional)</span>
            </label>
            {loadingRoles ? (
              <div className="text-xs text-plm-fg-muted py-2">Loading roles...</div>
            ) : workflowRoles.length === 0 ? (
              <div className="text-xs text-plm-fg-muted py-2 bg-plm-bg rounded p-2">
                No workflow roles defined.{' '}
                <button
                  onClick={() => {
                    const { setActiveView } = usePDMStore.getState()
                    setActiveView('settings')
                    window.dispatchEvent(new CustomEvent('navigate-settings-tab', { detail: 'team-members' }))
                    setTimeout(() => {
                      window.dispatchEvent(new CustomEvent('navigate-team-members-tab', { detail: 'users' }))
                    }, 50)
                    onClose()
                  }}
                  className="text-plm-accent hover:underline"
                >
                  Create roles in Settings
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5 p-2 bg-plm-bg rounded border border-plm-border max-h-24 overflow-y-auto">
                {workflowRoles.map(role => (
                  <button
                    key={role.id}
                    onClick={() => toggleWorkflowRole(role.id)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                      allowedWorkflowRoles.includes(role.id)
                        ? 'ring-1 ring-plm-accent'
                        : 'hover:bg-plm-highlight'
                    }`}
                    style={{
                      backgroundColor: allowedWorkflowRoles.includes(role.id) ? role.color + '30' : undefined
                    }}
                    title={allowedWorkflowRoles.includes(role.id) ? 'Click to remove' : 'Click to allow this role'}
                  >
                    <BadgeCheck size={12} style={{ color: role.color }} />
                    <span>{role.name}</span>
                    {allowedWorkflowRoles.includes(role.id) && (
                      <CheckCircle size={10} className="text-plm-success" />
                    )}
                  </button>
                ))}
              </div>
            )}
            {allowedWorkflowRoles.length > 0 && (
              <p className="text-[10px] text-plm-fg-muted mt-1">
                Users with {allowedWorkflowRoles.length === 1 ? 'this workflow role' : 'any of these workflow roles'} can execute this transition
              </p>
            )}
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
            onClick={() => onSave({
              name: name || null,
              description: description || null,
              line_style: lineStyle,
              allowed_workflow_roles: allowedWorkflowRoles,
            })}
            className="px-3 py-1.5 text-sm bg-plm-accent hover:bg-plm-accent-hover text-white rounded"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
