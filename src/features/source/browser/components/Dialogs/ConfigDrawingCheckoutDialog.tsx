import { memo, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, File, Lock, X } from 'lucide-react'

import { t } from '@/lib/i18n'
import type { DrawingRefItem, LocalFile } from '@/stores/types'

import type { ConfigDrawingUpdatePlan } from '../../hooks/useConfigDrawingUpdate'

export interface ConfigDrawingCheckoutDialogProps {
  plan: ConfigDrawingUpdatePlan
  onCheckOutAndUpdate: () => void
  onForceModelOnly: () => void
  onCancel: () => void
}

interface DrawingListProps {
  files: LocalFile[]
  status: string
  icon: ReactNode
  statusClassName: string
}

interface BlockedDrawingListProps {
  drawings: { file: LocalFile; holderName: string }[]
}

interface UnresolvedDrawingListProps {
  drawings: DrawingRefItem[]
}

function DrawingList({ files, status, icon, statusClassName }: DrawingListProps) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-1 text-xs font-medium text-plm-fg-muted">
        {icon}
        <span>{status}</span>
        <span className="text-plm-fg-dim">({files.length})</span>
      </div>
      <div className="space-y-1">
        {files.map((file) => (
          <div key={file.path} className="flex items-center gap-2 text-sm min-w-0">
            <File size={14} className="text-plm-fg-muted flex-shrink-0" />
            <span className="truncate text-plm-fg">{file.name}</span>
            <span className={`ml-auto flex-shrink-0 text-xs ${statusClassName}`}>{status}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function BlockedDrawingList({ drawings }: BlockedDrawingListProps) {
  const statusLabel = (holderName: string): string =>
    t('source.configDrawings.heldBy', { name: holderName })

  return (
    <section>
      <div className="flex items-center gap-2 mb-1 text-xs font-medium text-plm-fg-muted">
        <Lock size={14} className="text-plm-warning flex-shrink-0" />
        <span>{t('source.configDrawings.blocked', 'Held by others')}</span>
        <span className="text-plm-fg-dim">({drawings.length})</span>
      </div>
      <div className="space-y-1">
        {drawings.map(({ file, holderName }) => (
          <div key={file.path} className="flex items-center gap-2 text-sm min-w-0">
            <File size={14} className="text-plm-warning flex-shrink-0" />
            <span className="truncate text-plm-fg">{file.name}</span>
            <span className="ml-auto flex-shrink-0 text-xs text-plm-warning">
              {statusLabel(holderName)}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function UnresolvedDrawingList({ drawings }: UnresolvedDrawingListProps) {
  const status = t('source.configDrawings.notInVault', 'Not in this vault')

  return (
    <section>
      <div className="flex items-center gap-2 mb-1 text-xs font-medium text-plm-fg-muted">
        <AlertTriangle size={14} className="text-plm-fg-muted flex-shrink-0" />
        <span>{status}</span>
        <span className="text-plm-fg-dim">({drawings.length})</span>
      </div>
      <div className="space-y-1">
        {drawings.map((drawing) => (
          <div key={drawing.id} className="flex items-center gap-2 text-sm min-w-0">
            <File size={14} className="text-plm-fg-muted flex-shrink-0" />
            <span className="truncate text-plm-fg">{drawing.file_name}</span>
            <span className="ml-auto flex-shrink-0 text-xs text-plm-fg-muted">{status}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

export const ConfigDrawingCheckoutDialog = memo(function ConfigDrawingCheckoutDialog({
  plan,
  onCheckOutAndUpdate,
  onForceModelOnly,
  onCancel,
}: ConfigDrawingCheckoutDialogProps) {
  const readyStatus = t('source.configDrawings.ready', 'Ready to update')
  const availableStatus = t(
    'source.configDrawings.available',
    'Available to check out',
  )

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="bg-plm-bg-light border border-plm-border rounded-lg p-6 max-w-xl w-full mx-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="config-drawing-checkout-title"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-plm-warning/20 flex items-center justify-center">
            <AlertTriangle size={20} className="text-plm-warning" />
          </div>
          <h3
            id="config-drawing-checkout-title"
            className="text-lg font-semibold text-plm-fg"
          >
            {t('source.configDrawings.dialogTitle', 'Drawings reference this configuration')}
          </h3>
        </div>

        <p className="text-sm text-plm-fg-dim mb-4">
          {t(
            'source.configDrawings.dialogBody',
            'Some referenced drawings are not checked out by you. They must be checked out before they can receive the update.',
          )}
        </p>

        <div className="bg-plm-bg rounded border border-plm-border p-3 mb-4 max-h-64 overflow-y-auto space-y-4">
          {plan.mine.length > 0 && (
            <DrawingList
              files={plan.mine}
              status={readyStatus}
              icon={<CheckCircle2 size={14} className="text-plm-success flex-shrink-0" />}
              statusClassName="text-plm-success"
            />
          )}
          {plan.available.length > 0 && (
            <DrawingList
              files={plan.available}
              status={availableStatus}
              icon={<Lock size={14} className="text-plm-info flex-shrink-0" />}
              statusClassName="text-plm-info"
            />
          )}
          {plan.blocked.length > 0 && <BlockedDrawingList drawings={plan.blocked} />}
          {plan.unresolved.length > 0 && <UnresolvedDrawingList drawings={plan.unresolved} />}
        </div>

        <div className="bg-plm-warning/10 border border-plm-warning/30 rounded p-3 mb-4">
          <p className="text-sm text-plm-warning">
            {t(
              'source.configDrawings.modelOnlyWarning',
              'Write model only leaves drawings that are not checked out by you unchanged.',
            )}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={onCheckOutAndUpdate}
            className="btn bg-plm-success hover:bg-plm-success/80 text-white w-full justify-center"
          >
            <Lock size={14} />
            {t('source.configDrawings.checkOutAndUpdate', 'Check out and update')}
          </button>
          <button
            onClick={onForceModelOnly}
            className="btn bg-plm-warning hover:bg-plm-warning/80 text-white w-full justify-center"
          >
            <File size={14} />
            {t('source.configDrawings.forceModelOnly', 'Write model only')}
          </button>
          <button onClick={onCancel} className="btn btn-ghost w-full justify-center">
            <X size={14} />
            {t('common.cancel', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  )
})
