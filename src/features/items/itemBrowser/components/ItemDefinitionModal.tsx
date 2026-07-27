import { useState } from 'react'
import { X } from 'lucide-react'

import type {
  ItemDefinitionSettings,
  ItemFileType,
  ItemWorkflowStage,
} from '@/types/item'
import { ITEM_FILE_TYPES } from '@/types/item'

const FILE_TYPE_LABELS: Record<ItemFileType, string> = {
  part: 'Parts',
  assembly: 'Assemblies',
  drawing: 'Drawings',
  pdf: 'PDFs',
  step: 'STEP / neutral',
  other: 'Other',
}

export interface ItemDefinitionModalProps {
  definition: ItemDefinitionSettings
  stages: ItemWorkflowStage[]
  onSave: (definition: ItemDefinitionSettings) => Promise<void>
  onClose: () => void
  isSaving: boolean
}

export function ItemDefinitionModal({
  definition,
  stages,
  onSave,
  onClose,
  isSaving,
}: ItemDefinitionModalProps) {
  const [form, setForm] = useState<ItemDefinitionSettings>(definition)

  const toggleStage = (stageId: string) => {
    setForm((prev) => {
      const has = prev.workflowStageIds.includes(stageId)
      return {
        ...prev,
        workflowStageIds: has
          ? prev.workflowStageIds.filter((id) => id !== stageId)
          : [...prev.workflowStageIds, stageId],
      }
    })
  }

  const toggleType = (type: ItemFileType) => {
    setForm((prev) => {
      const has = prev.fileTypes.includes(type)
      return {
        ...prev,
        fileTypes: has ? prev.fileTypes.filter((t) => t !== type) : [...prev.fileTypes, type],
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-plm-bg-light border border-plm-border rounded-xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-plm-border">
          <div>
            <h3 className="text-lg font-medium text-plm-fg">Item Definition</h3>
            <p className="text-xs text-plm-fg-muted mt-0.5">
              Define which files count as an item across the vault.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-plm-fg-muted hover:text-plm-fg transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {/* Require part number */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.requirePartNumber}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, requirePartNumber: e.target.checked }))
              }
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-medium text-plm-fg">Require an item number</span>
              <span className="block text-xs text-plm-fg-muted">
                Only files that have a part/item number are counted.
              </span>
            </span>
          </label>

          {/* Match org part number format */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.matchOrgFormat}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, matchOrgFormat: e.target.checked }))
              }
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-medium text-plm-fg">
                Match organization part number format
              </span>
              <span className="block text-xs text-plm-fg-muted">
                Only show item numbers that match the org serialization format.
              </span>
            </span>
          </label>

          {/* Workflow stage */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-plm-fg">Workflow stage</span>
              <label className="flex items-center gap-2 cursor-pointer text-xs text-plm-fg-muted">
                <input
                  type="checkbox"
                  checked={form.anyStage}
                  onChange={(e) => setForm((prev) => ({ ...prev, anyStage: e.target.checked }))}
                />
                Any stage
              </label>
            </div>
            {!form.anyStage &&
              (stages.length === 0 ? (
                <p className="text-xs text-plm-fg-muted">No workflow stages found.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {stages.map((stage) => (
                    <label
                      key={stage.id}
                      className="flex items-center gap-2 cursor-pointer text-sm text-plm-fg"
                    >
                      <input
                        type="checkbox"
                        checked={form.workflowStageIds.includes(stage.id)}
                        onChange={() => toggleStage(stage.id)}
                      />
                      <span className="flex items-center gap-1.5 min-w-0">
                        {stage.color && (
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: stage.color }}
                          />
                        )}
                        <span className="truncate">{stage.label || stage.name}</span>
                      </span>
                    </label>
                  ))}
                </div>
              ))}
          </div>

          {/* File types */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-plm-fg">File types</span>
              <label className="flex items-center gap-2 cursor-pointer text-xs text-plm-fg-muted">
                <input
                  type="checkbox"
                  checked={form.anyType}
                  onChange={(e) => setForm((prev) => ({ ...prev, anyType: e.target.checked }))}
                />
                Any type
              </label>
            </div>
            {!form.anyType && (
              <div className="grid grid-cols-2 gap-2">
                {ITEM_FILE_TYPES.map((type) => (
                  <label
                    key={type}
                    className="flex items-center gap-2 cursor-pointer text-sm text-plm-fg"
                  >
                    <input
                      type="checkbox"
                      checked={form.fileTypes.includes(type)}
                      onChange={() => toggleType(type)}
                    />
                    {FILE_TYPE_LABELS[type]}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 justify-end px-6 py-4 border-t border-plm-border">
          <button onClick={onClose} className="btn btn-ghost" disabled={isSaving}>
            Cancel
          </button>
          <button onClick={() => onSave(form)} className="btn btn-primary" disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
