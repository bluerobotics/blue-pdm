// Confirmation shown before an import replaces the current workflow graph
import { t } from '@/lib/i18n'

import type { PendingImport } from '../hooks/useWorkflowIO'

interface ImportWorkflowDialogProps {
  pending: PendingImport
  workflowName: string
  isImporting: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ImportWorkflowDialog({
  pending,
  workflowName,
  isImporting,
  onConfirm,
  onCancel,
}: ImportWorkflowDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
      onClick={onCancel}
    >
      <div
        className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-medium text-plm-fg mb-4">{t('workflows.import.title')}</h3>
        <p className="text-base text-plm-fg-muted mb-4">
          {t('workflows.import.question', { file: pending.file.name })}
          <br />
          <br />
          {t('workflows.import.warning', {
            workflow: workflowName,
            states: pending.stateCount,
            transitions: pending.transitionCount,
            gates: pending.gateCount,
          })}
        </p>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="btn btn-ghost" disabled={isImporting}>
            {t('common.cancel')}
          </button>
          <button onClick={onConfirm} disabled={isImporting} className="btn btn-primary">
            {isImporting ? t('workflows.import.importing') : t('workflows.import.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
